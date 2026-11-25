# frozen_string_literal: true

# App Store version states in which a version is not out yet, in one place.
# Apple keeps one such version per platform, so another version in any of these
# states holds the next one:
#   - the iOS draft lane (fastlane/Fastfile, other_open_app_store_versions)
#     refuses to draft, because deliver would rename an editable version and an
#     approved one has to be released first;
#   - the merge-back submission's status check (store_submission_status.rb)
#     classifies the next version by which group the other version is in.
# The live version (READY_FOR_DISTRIBUTION, legacy READY_FOR_SALE) and replaced
# or removed versions hold nothing. appVersionState names first, then the legacy
# appStoreState names that differ.
module BoardseshAppStoreVersionStates
  # Being prepared, or in a review draft that has not been sent.
  EDITABLE = %w[PREPARE_FOR_SUBMISSION READY_FOR_REVIEW].freeze
  # Sent back by Apple or pulled by us, or a broken binary: only a person in App
  # Store Connect moves these on.
  NEEDS_PERSON = %w[DEVELOPER_REJECTED REJECTED METADATA_REJECTED INVALID_BINARY].freeze
  # Queued for or in App Review.
  IN_REVIEW = %w[WAITING_FOR_REVIEW IN_REVIEW].freeze
  # Approved and not released yet (a manual release waiting, Apple's own release
  # running, or paperwork such as export compliance or a contract).
  APPROVED_UNRELEASED = %w[
    ACCEPTED WAITING_FOR_EXPORT_COMPLIANCE PENDING_DEVELOPER_RELEASE PENDING_APPLE_RELEASE
    PROCESSING_FOR_DISTRIBUTION PROCESSING_FOR_APP_STORE PENDING_CONTRACT
  ].freeze
  OPEN = (EDITABLE + NEEDS_PERSON + IN_REVIEW + APPROVED_UNRELEASED).freeze
end
