# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
require "fileutils"
require "digest"
require_relative "../lib/play_listing"

class PlayListingTest < Minitest::Test
  def self.model(attributes)
    Struct.new(*attributes.keys, keyword_init: true).new(**attributes)
  end

  class NotFound < StandardError
    def status_code
      404
    end
  end

  class Refused < StandardError
    def status_code
      400
    end

    def body
      JSON.generate({ "error" => { "status" => "FAILED_PRECONDITION",
        "message" => "Changes are in review. Contact owner@example.com with Bearer ya29.secret-token" } })
    end
  end

  class FakePlay
    attr_accessor :listings, :remote_images, :fail_at
    attr_reader :calls

    def initialize
      @calls, @listings, @remote_images = [], {}, {}
    end

    def record(name, *arguments)
      @calls << [name, *arguments]
      raise Refused, "secret Play diagnostic" if @fail_at == name
    end

    def insert_edit(package)
      record(:insert_edit, package)
      PlayListingTest.model(id: "edit-1")
    end

    def get_edit_listing(package, edit, language)
      record(:get_edit_listing, package, edit, language)
      raise NotFound, "no listing" unless @listings.key?(language)
      PlayListingTest.model(**@listings.fetch(language))
    end

    def update_edit_listing(package, edit, language, listing)
      record(:update_edit_listing, package, edit, language, listing.to_h)
    end

    def list_edit_images(package, edit, language, image_type)
      record(:list_edit_images, package, edit, language, image_type)
      images = Array(@remote_images[[language, image_type]]).map { |id, sha256| PlayListingTest.model(id: id, sha256: sha256) }
      PlayListingTest.model(images: images)
    end

    def delete_edit_image(package, edit, language, image_type, image_id)
      record(:delete_edit_image, package, edit, language, image_type, image_id)
    end

    def upload_edit_image(package, edit, language, image_type, upload_source:, content_type:)
      record(:upload_edit_image, package, edit, language, image_type, File.basename(upload_source), content_type)
    end

    def validate_edit(package, edit)
      record(:validate_edit, package, edit)
    end

    def commit_edit(package, edit, changes_in_review_behavior: nil, changes_not_sent_for_review: nil)
      record(:commit_edit, package, edit, { changes_in_review_behavior: changes_in_review_behavior,
        changes_not_sent_for_review: changes_not_sent_for_review })
    end
  end

  def setup
    @directory = Dir.mktmpdir("play-listing-test-")
    {
      "en-US" => { "title.txt" => "Boardsesh\n", "short_description.txt" => "Climb with your crew\n", "full_description.txt" => "Long copy\n" },
      "de-DE" => { "title.txt" => "Boardsesh\n" }
    }.each do |language, files|
      FileUtils.mkdir_p(File.join(@directory, language, "changelogs"))
      files.each { |name, text| File.write(File.join(@directory, language, name), text) }
      File.write(File.join(@directory, language, "changelogs", "default.txt"), "Never uploaded here\n")
    end
    FileUtils.mkdir_p(File.join(@directory, "en-US", "images", "phoneScreenshots"))
    File.write(File.join(@directory, "en-US", "images", "icon.png"), "icon-bytes")
    File.write(File.join(@directory, "en-US", "images", "featureGraphic.png"), "feature-bytes")
    %w[01-home 02-board 03-log].each { |name| File.write(File.join(@directory, "en-US", "images", "phoneScreenshots", "#{name}.png"), "#{name}-bytes") }
    @play = FakePlay.new
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def runner(parts, **overrides)
    options = { service: @play, metadata_path: @directory, parts: parts,
      model_factory: ->(_name, attributes) { self.class.model(attributes) } }
    BoardseshPlayListing::Runner.new(**options.merge(overrides))
  end

  def sha(name)
    Digest::SHA256.hexdigest("#{name}-bytes")
  end

  def commit_call
    @play.calls.find { |call| call.first == :commit_edit }
  end

  def test_listing_text_commits_in_one_edit_that_never_cancels_a_review
    @play.listings["en-US"] = { title: "Old", short_description: "Old", full_description: "Old", video: "https://youtube.example/v" }
    receipt = runner(["listing"]).run
    assert_equal [:insert_edit, :get_edit_listing, :update_edit_listing, :get_edit_listing, :update_edit_listing,
      :validate_edit, :commit_edit], @play.calls.map(&:first)
    assert_equal({ changes_in_review_behavior: "ERROR_IF_IN_REVIEW", changes_not_sent_for_review: false }, commit_call.last)
    updates = @play.calls.select { |call| call.first == :update_edit_listing }.to_h { |call| [call[3], call[4]] }
    # Only fields with a committed file change, and text is sent as committed (supply did the same).
    assert_equal({ language: "en-US", title: "Boardsesh\n", short_description: "Climb with your crew\n",
      full_description: "Long copy\n", video: "https://youtube.example/v" }, updates.fetch("en-US"))
    # A language Play does not have yet starts from an empty listing.
    assert_equal({ language: "de-DE", title: "Boardsesh\n", short_description: nil, full_description: nil, video: nil }, updates.fetch("de-DE"))
    assert_equal "committed", receipt.fetch("action")
    assert_equal %w[de-DE en-US], receipt.fetch("languages")
    refute @play.calls.any? { |call| %i[upload_edit_image delete_edit_image list_edit_images].include?(call.first) }
  end

  def test_images_replace_single_images_only
    runner(["images"]).run
    uploads = @play.calls.select { |call| call.first == :upload_edit_image }
    assert_equal [["en-US", "featureGraphic", "featureGraphic.png", "image/*"], ["en-US", "icon", "icon.png", "image/*"]],
      uploads.map { |call| call[3..6] }
    refute @play.calls.any? { |call| %i[update_edit_listing delete_edit_image].include?(call.first) }
    assert_equal({ changes_in_review_behavior: "ERROR_IF_IN_REVIEW", changes_not_sent_for_review: false }, commit_call.last)
  end

  # supply's sync_image_upload: keep the leading remote images that already match
  # the local order, delete everything else, upload the rest.
  def test_screenshots_sync_by_checksum_in_order
    @play.remote_images[["en-US", "phoneScreenshots"]] = [["keep", sha("01-home")], ["stale", "0" * 64], ["moved", sha("03-log")]]
    runner(["screenshots"]).run
    deletes = @play.calls.select { |call| call.first == :delete_edit_image }.map(&:last)
    uploads = @play.calls.select { |call| call.first == :upload_edit_image }.map { |call| call[5] }
    assert_equal %w[stale moved], deletes
    assert_equal %w[02-board.png 03-log.png], uploads
  end

  def test_an_unchanged_screenshot_set_uploads_nothing
    @play.remote_images[["en-US", "phoneScreenshots"]] = %w[01-home 02-board 03-log].map { |name| [name, sha(name)] }
    runner(["screenshots"]).run
    refute @play.calls.any? { |call| %i[delete_edit_image upload_edit_image].include?(call.first) }
    assert commit_call
  end

  # With a release in review, ERROR_IF_IN_REVIEW makes Play refuse the commit. The
  # lane reports that plainly and never retries with relaxed flags.
  def test_a_refused_commit_fails_once_with_googles_scrubbed_reason_and_no_retry
    @play.fail_at = :commit_edit
    error = assert_raises(BoardseshPlayListing::Error) { runner(["listing"]).run }
    assert_includes error.message, "(HTTP 400): FAILED_PRECONDITION: Changes are in review."
    assert_includes error.message, "[redacted email]"
    assert_includes error.message, "Bearer [redacted]"
    refute_includes error.message, "secret"
    refute_includes error.message, "owner@example.com"
    assert_equal 1, @play.calls.count { |call| call.first == :commit_edit }
  end

  def test_error_detail_keeps_only_googles_envelope
    assert_nil BoardseshPlayListing.error_detail("<html>secret upstream page</html>")
    assert_nil BoardseshPlayListing.error_detail(JSON.generate({ "error" => { "status" => "INVALID" } }))
    assert_nil BoardseshPlayListing.error_detail(nil)
    long = BoardseshPlayListing.error_detail(JSON.generate({ "error" => { "status" => "lower case", "message" => "x" * 400 } }))
    assert_equal "#{'x' * 300}…", long
    key = BoardseshPlayListing.error_detail(JSON.generate({ "error" => { "message" => "bad -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY----- here" } }))
    assert_equal "bad [redacted key] here", key
  end

  def test_a_failure_before_commit_never_commits
    @play.fail_at = :upload_edit_image
    assert_raises(BoardseshPlayListing::Error) { runner(["images"]).run }
    refute commit_call
  end

  def test_refuses_an_old_client_without_review_protection
    old_client = Object.new
    def old_client.commit_edit(_package, _edit, changes_not_sent_for_review: nil); end
    error = assert_raises(BoardseshPlayListing::Error) { runner(["listing"], service: old_client).run }
    assert_includes error.message, "review protection"
  end

  def test_local_inputs_are_checked_before_credentials_resolve
    resolved = false
    service = -> { resolved = true; @play }
    [[], ["changelogs"], %w[listing listing]].each do |parts|
      assert_raises(BoardseshPlayListing::Error, parts.inspect) { runner(parts, service: service) }
    end
    FileUtils.mkdir_p(File.join(@directory, "not a locale"))
    assert_raises(BoardseshPlayListing::Error) { runner(["listing"], service: service) }
    assert_raises(BoardseshPlayListing::Error) { runner(["listing"], service: service, metadata_path: File.join(@directory, "missing")) }
    refute resolved
  end

  def test_credentials_resolve_lazily_once_inputs_pass
    resolved = 0
    runner(["listing"], service: -> { resolved += 1; @play }).run
    assert_equal 1, resolved
  end
end
