#!/usr/bin/env bash
set -euo pipefail

candidate="${1:?usage: promote-assets-revision.sh <candidate-revision> <10|50|100|rollback> [stable-revision]}"
stage="${2:?usage: promote-assets-revision.sh <candidate-revision> <10|50|100|rollback> [stable-revision]}"
stable="${3:-}"
project="${GCP_PROJECT:-tokens-498908}"
region="${GCP_REGION:-us-east4}"
service="${ASSETS_SERVICE:-tokens-assets-prd-us}"

case "$stage" in
  10|50|100|rollback) ;;
  *) echo "stage must be 10, 50, 100, or rollback" >&2; exit 2 ;;
esac

ready=$(
  gcloud run revisions describe "$candidate" \
    --project="$project" \
    --region="$region" \
    --format=json \
    | jq -r '[.status.conditions[] | select(.type == "Ready") | .status] | .[0] // "False"'
)
if [ "$ready" != "True" ]; then
  echo "Candidate $candidate is not Ready; refusing to change traffic." >&2
  exit 1
fi

if [ -z "$stable" ]; then
  stable=$(
    gcloud run services describe "$service" --project="$project" --region="$region" --format=json \
      | jq -r --arg candidate "$candidate" '
          [.status.traffic[]
           | select(.revisionName != null and .revisionName != $candidate and (.percent // 0) > 0)]
          | sort_by(.percent)
          | last
          | .revisionName // empty
        '
  )
fi

if [ "$stage" = "rollback" ]; then
  if [ -z "$stable" ]; then
    echo "Rollback requires the previous stable revision as the third argument." >&2
    exit 1
  fi
  gcloud run services update-traffic "$service" \
    --project="$project" --region="$region" \
    --to-revisions="$stable=100" --quiet
  echo "Rolled $service back to $stable at 100%."
  exit 0
fi

if [ "$stage" = "100" ]; then
  allocation="$candidate=100"
else
  if [ -z "$stable" ]; then
    echo "Could not determine the current stable revision; pass it as the third argument." >&2
    exit 1
  fi
  allocation="$candidate=$stage,$stable=$((100 - stage))"
fi

gcloud run services update-traffic "$service" \
  --project="$project" --region="$region" \
  --to-revisions="$allocation" --quiet

echo "Traffic updated: $allocation"
if [ -n "$stable" ]; then
  echo "Record stable revision for rollback: $stable"
fi
echo "Observe for at least 15 minutes before running the next stage."
