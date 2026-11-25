# frozen_string_literal: true

require "digest"
require "json"
require_relative "android_release"

# Pushes the committed Google Play listing (text, images, phone screenshots) in one
# edit of our own and commits it with changesInReviewBehavior=ERROR_IF_IN_REVIEW.
#
# fastlane supply commits without that parameter, and the API default cancels
# whatever is in review and resubmits it. Once a merge-back sends a production
# release for review (mobile-store-submit.yml), a listing push would quietly restart
# that review. Here a pending review makes the commit fail instead, and nothing is
# cancelled.
#
# Everything else mirrors the supply calls these lanes used (supply 2.240.1,
# uploader.rb and client.rb), so the store ends up the same: the listing is read
# and only fields with a committed file are replaced, images upload as they are,
# and screenshots sync by SHA-256 in order (matching leading images are kept, the
# rest are deleted, the remainder uploads). No release, track or changelog is
# touched, and the commit is never retried with relaxed flags.
module BoardseshPlayListing
  class Error < StandardError; end
  PACKAGE_NAME = BoardseshAndroidRelease::PACKAGE_NAME
  LISTING_FIELDS = %w[title short_description full_description video].freeze
  IMAGE_TYPES = %w[featureGraphic icon tvBanner].freeze
  SCREENSHOT_TYPES = %w[phoneScreenshots sevenInchScreenshots tenInchScreenshots tvScreenshots wearScreenshots].freeze
  IMAGE_GLOB = "{png,jpg,jpeg}"
  PARTS = %w[listing images screenshots].freeze
  LOCALE = /\A[a-z]{2,3}(-[A-Za-z0-9]{2,8})*\z/
  # Same bound as playErrorDetail in scripts/lib/google-play-tracks.ts.
  ERROR_MESSAGE_LIMIT = 300

  # Google's own error envelope ({"error":{"status","message"}}) from a failed
  # call, scrubbed the way scripts/lib/google-play-tracks.ts's playErrorDetail
  # scrubs it: PEM keys, bearer, OAuth and JWT tokens and email addresses are
  # redacted, whitespace collapsed, and the message cut at 300 characters. Any
  # other body text is never returned, so a non-JSON body gives nil.
  def self.error_detail(body)
    parsed = JSON.parse(body.to_s)
    envelope = parsed.is_a?(Hash) ? parsed["error"] : nil
    return nil unless envelope.is_a?(Hash)
    message = envelope["message"]
    return nil unless message.is_a?(String) && !message.strip.empty?
    scrubbed = message
      .gsub(/-----BEGIN[\s\S]*?(-----END[^-]*-----|\z)/, "[redacted key]")
      .gsub(/\bBearer\s+\S+/i, "Bearer [redacted]")
      .gsub(/\bya29\.[\w.-]+/, "[redacted token]")
      .gsub(/\beyJ[\w-]*\.[\w-]+(\.[\w-]*)?/, "[redacted token]")
      .gsub(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "[redacted email]")
      .gsub(/\s+/, " ").strip
    scrubbed = "#{scrubbed[0, ERROR_MESSAGE_LIMIT]}…" if scrubbed.length > ERROR_MESSAGE_LIMIT
    status = envelope["status"]
    prefix = status.is_a?(String) && status.match?(/\A[A-Z_]{1,64}\z/) ? "#{status}: " : ""
    "#{prefix}#{scrubbed}"
  rescue JSON::ParserError
    nil
  end

  class Runner
    attr_reader :log

    def initialize(service:, metadata_path:, parts:, model_factory: BoardseshAndroidRelease.method(:models))
      @service, @metadata_path, @model_factory = service, File.expand_path(metadata_path), model_factory
      @parts = Array(parts).map(&:to_s)
      raise Error, "Choose one or more listing parts: #{PARTS.join(', ')}" if @parts.empty? || (@parts - PARTS).any? || @parts.uniq != @parts
      raise Error, "No Play metadata folder at #{@metadata_path}" unless File.directory?(@metadata_path)
      @languages = Dir.children(@metadata_path).select { |entry| File.directory?(File.join(@metadata_path, entry)) }
        .reject { |entry| entry.start_with?(".") }.sort
      raise Error, "No Play listing languages under #{@metadata_path}" if @languages.empty?
      invalid = @languages.reject { |language| language.match?(LOCALE) }
      raise Error, "Unexpected Play listing folder(s): #{invalid.join(', ')}" unless invalid.empty?
      @log = []
    end

    def run
      # Resolve credentials only after the local folders were checked.
      @service = @service.call if @service.respond_to?(:call)
      unless @service.method(:commit_edit).parameters.include?([:key, :changes_in_review_behavior])
        raise Error, "Google Play API client lacks strict review protection; update the pinned client"
      end
      edit_id = @service.insert_edit(PACKAGE_NAME).id
      raise Error, "Google Play returned an invalid edit ID" unless edit_id.to_s.match?(/\A[A-Za-z0-9_-]+\z/)
      @languages.each do |language|
        update_listing(edit_id, language) if @parts.include?("listing")
        upload_images(edit_id, language) if @parts.include?("images")
        sync_screenshots(edit_id, language) if @parts.include?("screenshots")
      end
      @service.validate_edit(PACKAGE_NAME, edit_id)
      @service.commit_edit(PACKAGE_NAME, edit_id,
        changes_not_sent_for_review: false, changes_in_review_behavior: "ERROR_IF_IN_REVIEW")
      { "action" => "committed", "packageName" => PACKAGE_NAME, "parts" => @parts, "languages" => @languages, "changes" => @log }
    rescue Error
      raise
    rescue StandardError => error
      status = error.respond_to?(:status_code) ? error.status_code.to_i : nil
      suffix = status && status.positive? ? " (HTTP #{status})" : ""
      detail = error.respond_to?(:body) ? BoardseshPlayListing.error_detail(error.body) : nil
      raise Error, "Google Play listing commit was not confirmed#{suffix}#{detail ? ": #{detail}" : ''}. If something is in " \
        "review, Play refused the commit rather than cancel that review; push the listing again after the review ends."
    end

    private

    def update_listing(edit_id, language)
      files = LISTING_FIELDS.to_h { |field| [field, File.join(@metadata_path, language, "#{field}.txt")] }.select { |_field, path| File.file?(path) }
      return if files.empty?
      existing = begin
        @service.get_edit_listing(PACKAGE_NAME, edit_id, language)
      rescue StandardError => error
        raise unless error.respond_to?(:status_code) && error.status_code.to_i == 404
        nil # A new language: supply creates an empty listing.
      end
      fields = LISTING_FIELDS.to_h { |field| [field.to_sym, existing&.public_send(field)] }
      files.each do |field, path|
        text = File.read(path, encoding: "UTF-8")
        raise Error, "#{language}/#{field}.txt must be UTF-8" unless text.valid_encoding?
        fields[field.to_sym] = text
      end
      listing = @model_factory.call("Listing", { language: language, **fields })
      @service.update_edit_listing(PACKAGE_NAME, edit_id, language, listing)
      @log << "#{language}: listing #{files.keys.join(', ')}"
    end

    def upload_images(edit_id, language)
      IMAGE_TYPES.each do |image_type|
        path = Dir.glob(File.join(@metadata_path, language, "images", "#{image_type}.#{IMAGE_GLOB}"), File::FNM_CASEFOLD).sort.last
        next unless path
        upload(edit_id, language, image_type, path)
      end
    end

    def sync_screenshots(edit_id, language)
      SCREENSHOT_TYPES.each do |image_type|
        paths = Dir.glob(File.join(@metadata_path, language, "images", image_type, "*.#{IMAGE_GLOB}"), File::FNM_CASEFOLD).sort
        next if paths.empty?
        existing = Array(@service.list_edit_images(PACKAGE_NAME, edit_id, language, image_type).images)
        next_checksum = Digest::SHA256.file(paths.first).hexdigest
        existing.each do |image|
          if !next_checksum.nil? && image.sha256 == next_checksum
            paths.shift
            next_checksum = paths.empty? ? nil : Digest::SHA256.file(paths.first).hexdigest
          else
            image_id = image.id.to_s
            raise Error, "Google Play returned an invalid image ID" unless image_id.match?(/\A[A-Za-z0-9_-]+\z/)
            @service.delete_edit_image(PACKAGE_NAME, edit_id, language, image_type, image_id)
            @log << "#{language}: removed #{image_type} #{image_id}"
          end
        end
        paths.each { |path| upload(edit_id, language, image_type, path) }
      end
    end

    def upload(edit_id, language, image_type, path)
      @service.upload_edit_image(PACKAGE_NAME, edit_id, language, image_type, upload_source: path, content_type: "image/*")
      @log << "#{language}: uploaded #{image_type} #{File.basename(path)}"
    end
  end
end
