# frozen_string_literal: true

require "time"
require_relative "asc_client"

# Apple documents releaseType (MANUAL, AFTER_APPROVAL, SCHEDULED) in
# AppStoreVersionUpdateRequest.Data.Attributes. This helper sets MANUAL (the
# hand-run default) or AFTER_APPROVAL (the automatic merge-back submission in
# mobile-store-submit.yml, so the app releases once Apple approves it). It never
# submits a review, schedules a release, or releases an approved app.
module BoardseshStoreReleaseControl
  class Error < StandardError; end
  APP_IDENTIFIER = "com.boardsesh.app"
  EDITABLE = %w[PREPARE_FOR_SUBMISSION READY_FOR_REVIEW].freeze
  RELEASE_TYPES = %w[MANUAL AFTER_APPROVAL].freeze

  # "AFTER_APPROVAL" -> "after-approval", for receipt actions and messages.
  def self.release_type_slug(release_type)
    release_type.downcase.tr("_", "-")
  end

  class Client < BoardseshASC::Client
    def request(method, path, body = nil)
      raise Error, "Release control reads must use GET" unless method == "GET" && body.nil?
      super
    end

    # Construct the only permitted write here: releaseType alone, MANUAL or
    # AFTER_APPROVAL. Do not use the shared client's retrying PATCH implementation,
    # even when the response outcome is ambiguous.
    def set_release_type(version_id, release_type)
      raise Error, "Invalid app version resource ID" unless version_id.match?(/\A[A-Za-z0-9-]+\z/)
      raise Error, "Release type must be MANUAL or AFTER_APPROVAL" unless RELEASE_TYPES.include?(release_type)
      label = release_type == "MANUAL" ? "Manual" : "After-approval"
      uri = URI("#{ORIGIN}/v1/appStoreVersions/#{version_id}")
      http = @transport.call(uri)
      http.use_ssl = true
      http.open_timeout, http.read_timeout = 30, 120
      http.max_retries = 0
      request = Net::HTTP::Patch.new(uri, { "Authorization" => "Bearer #{@token.call}", "Content-Type" => "application/json" })
      request.body = JSON.generate({ "data" => {
        "type" => "appStoreVersions", "id" => version_id,
        "attributes" => { "releaseType" => release_type }
      } })
      response = http.request(request)
      unless response.code.to_i.between?(200, 299)
        raise Error, "#{label} release write not confirmed (HTTP #{response.code.to_i}); audit before retrying"
      end
      # The independent GET readback, not the PATCH body, proves the outcome.
      nil
    rescue Net::OpenTimeout, Net::ReadTimeout, IOError, SystemCallError => error
      raise Error, "#{label} release write outcome is ambiguous (#{error.class}); audit before retrying"
    end

    def make_manual(version_id)
      set_release_type(version_id, "MANUAL")
    end
  end

  class Runner
    attr_reader :receipt

    def initialize(client:, version:, build_number:, release_type: "MANUAL")
      raise Error, "Expected iOS version must be semver" unless version.match?(/\A\d+\.\d+\.\d+\z/)
      raise Error, "Expected build must be numeric" unless build_number.match?(/\A[1-9]\d*\z/)
      raise Error, "Release type must be MANUAL or AFTER_APPROVAL" unless RELEASE_TYPES.include?(release_type)
      @client, @version, @build_number, @release_type = client, version, build_number, release_type
      @receipt = { "schemaVersion" => 1, "appIdentifier" => APP_IDENTIFIER, "expectedVersion" => version,
        "expectedBuild" => build_number, "requestedReleaseType" => release_type, "writeAttempted" => false, "status" => "checking" }
    end

    def run
      slug = BoardseshStoreReleaseControl.release_type_slug(@release_type)
      initial = read_snapshot
      @receipt["before"] = initial
      fresh = read_snapshot
      raise Error, "Release identity or settings changed during preflight; no write attempted" unless fresh == initial
      verify_binding(fresh)
      if fresh.dig("version", "releaseType") == @release_type
        return verified_receipt("already-#{slug}", fresh)
      end
      @receipt["writeAttempted"] = true
      @client.set_release_type(fresh.fetch("version").fetch("id"), @release_type)
      expected = Marshal.load(Marshal.dump(fresh))
      expected.fetch("version")["releaseType"] = @release_type
      readback = read_snapshot
      @receipt["readback"] = readback
      raise Error, "#{@release_type} release readback differs from the exact expected release; audit before retrying" unless readback == expected
      verify_binding(readback)
      verified_receipt("set-#{slug}", readback)
    rescue StandardError => error
      @receipt["status"] = @receipt["writeAttempted"] ? "outcome-unconfirmed" : "failed-before-write"
      @receipt["error"] = if error.is_a?(Error) || error.is_a?(BoardseshASC::Error)
        error.message
      else
        "Release control failed (#{error.class}); audit before retrying"
      end
      raise Error, @receipt.fetch("error")
    end

    private

    def resource_id(resource)
      id = resource.fetch("id")
      raise Error, "Invalid Apple resource identity" unless id.is_a?(String) && id.match?(/\A[A-Za-z0-9-]+\z/)
      id
    end

    def exactly_one(resources, label)
      raise Error, "Expected exactly one #{label}" unless resources.length == 1
      resources.first
    end

    def included(response, type, id)
      exactly_one(response.fetch("included").select { |resource| resource["type"] == type && resource["id"] == id }, "included #{type} resource")
    end

    def binding(version_id)
      response = @client.request("GET", "/v1/appStoreVersions/#{version_id}?include=app,build")
      version = response.fetch("data")
      raise Error, "App version resource identity changed" unless version["type"] == "appStoreVersions" && resource_id(version) == version_id
      attributes = version.fetch("attributes")
      state = attributes["appVersionState"] || attributes["appStoreState"]
      unless attributes["versionString"] == @version && attributes["platform"] == "IOS" && EDITABLE.include?(state)
        raise Error, "Expected exact editable iOS release before release control"
      end
      raise Error, "Unsupported release type; inspect scheduled release settings" unless %w[MANUAL AFTER_APPROVAL].include?(attributes["releaseType"])
      app_link = version.dig("relationships", "app", "data")
      build_link = version.dig("relationships", "build", "data")
      raise Error, "Missing version app/build relationships" unless app_link.is_a?(Hash) && app_link["type"] == "apps" && build_link.is_a?(Hash) && build_link["type"] == "builds"
      app = included(response, "apps", resource_id(app_link))
      build = included(response, "builds", resource_id(build_link))
      raise Error, "Version belongs to another app" unless app.dig("attributes", "bundleId") == APP_IDENTIFIER
      build_attributes = build.fetch("attributes")
      unless build_attributes["version"] == @build_number && build_attributes["processingState"] == "VALID" && build_attributes["expired"] == false
        raise Error, "Expected attached build is missing, invalid, or expired"
      end
      {
        "app" => { "id" => resource_id(app), "bundleId" => APP_IDENTIFIER },
        "version" => { "id" => version_id, "versionString" => @version, "platform" => "IOS", "state" => state,
          "releaseType" => attributes.fetch("releaseType"), "earliestReleaseDate" => attributes["earliestReleaseDate"] },
        "build" => { "id" => resource_id(build) }.merge(build_attributes.slice("version", "processingState", "expired"))
      }
    end

    def read_snapshot
      apps = @client.list("/v1/apps?filter[bundleId]=#{APP_IDENTIFIER}&limit=200")
      app = exactly_one(apps.select { |entry| entry["type"] == "apps" && entry.dig("attributes", "bundleId") == APP_IDENTIFIER }, "Boardsesh app")
      app_id = resource_id(app)
      versions = @client.list("/v1/apps/#{app_id}/appStoreVersions?filter[platform]=IOS&filter[versionString]=#{@version}&limit=200")
      version = exactly_one(versions.select { |entry| entry["type"] == "appStoreVersions" && entry.dig("attributes", "platform") == "IOS" && entry.dig("attributes", "versionString") == @version }, "matching iOS version")
      snapshot = binding(resource_id(version))
      raise Error, "Resolved app identity changed" unless snapshot.dig("app", "id") == app_id
      prerelease = @client.request("GET", "/v1/builds/#{snapshot.fetch('build').fetch('id')}/preReleaseVersion").fetch("data")
      unless prerelease && prerelease["type"] == "preReleaseVersions" && prerelease.dig("attributes", "version") == @version && prerelease.dig("attributes", "platform") == "IOS"
        raise Error, "Attached build belongs to another prerelease version"
      end
      snapshot["preReleaseVersion"] = { "id" => resource_id(prerelease), "version" => @version, "platform" => "IOS" }
      snapshot
    end

    # Last read before PATCH/no-op/verified receipt. Includes current app identity,
    # attached build identity/validity, state, and release settings in one response.
    def verify_binding(snapshot)
      raise Error, "Current app/build binding or release settings changed" unless binding(snapshot.fetch("version").fetch("id")) == snapshot.reject { |key, _entry| key == "preReleaseVersion" }
    end

    def verified_receipt(action, snapshot)
      @receipt.merge!("action" => action, "status" => "verified", "verifiedAt" => Time.now.utc.iso8601, "readback" => snapshot)
    end
  end

  def self.cli
    output = ENV.fetch("STORE_RELEASE_CONTROL_OUTPUT")
    runner = nil
    begin
      require "spaceship"
      token = Spaceship::ConnectAPI::Token.create(
        key_id: ENV.fetch("APP_STORE_CONNECT_API_KEY_ID"), issuer_id: ENV.fetch("APP_STORE_CONNECT_ISSUER_ID"),
        filepath: ENV.fetch("ASC_KEY_PATH"), in_house: false
      )
      client = Client.new(token: -> { token.refresh! if token.expired?; token.text })
      # Unset means MANUAL: the hand-run Apple Manual Release Control workflow sets
      # nothing. Only mobile-store-submit.yml asks for AFTER_APPROVAL.
      release_type = ENV.fetch("STORE_RELEASE_TYPE", "MANUAL")
      runner = Runner.new(client: client, version: ENV.fetch("RELEASE_VERSION"), build_number: ENV.fetch("IOS_BUILD_NUMBER"), release_type: release_type)
      runner.run
      puts "Apple #{release_type_slug(release_type)} release verified for #{ENV.fetch('RELEASE_VERSION')} build #{ENV.fetch('IOS_BUILD_NUMBER')}"
      0
    rescue StandardError => error
      warn(error.is_a?(Error) ? error.message : "Release control failed (#{error.class}); no verified outcome")
      1
    ensure
      receipt = runner&.receipt || { "status" => "failed-before-write", "writeAttempted" => false, "error" => "Release control initialization failed" }
      File.write(output, JSON.pretty_generate(receipt) + "\n")
    end
  end
end

exit BoardseshStoreReleaseControl.cli if $PROGRAM_NAME == __FILE__
