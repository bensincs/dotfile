#!/usr/bin/env bash
# Sets up narrated demos: deploys Azure AI Speech (infra/main.bicep), writes the local config,
# installs the recording runtime (Playwright, chalk, clay, diagram and terminal renderers, Azure icons) and checks speech works end to end.
#
#   setup.sh --subscription <id or name> [--location swedencentral] [--resource-group rg-narrated-demo]
#            [--name <speech resource>] [--sku S0|F0]
#
# swedencentral has every voice tier (HD, MAI and Azure OpenAI voices). F0 is free but limited
# to one per subscription and may not include HD voices.
#   setup.sh --runtime-only        # just install or repair the recording runtime
#
# Re-running is safe: the deployment is idempotent. Pass --name and --resource-group to adopt
# an existing Speech resource.
set -euo pipefail

skill="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="${NARRATED_DEMO_CONFIG:-$HOME/.config/narrated-demo/config.json}"
runtime="${NARRATED_DEMO_RUNTIME:-$HOME/.cache/narrated-demo}"
subscription="" location="swedencentral" group="rg-narrated-demo" name="" sku="S0" runtime_only=false

while [ $# -gt 0 ]; do
  case "$1" in
    --subscription) subscription="$2"; shift 2 ;;
    --location) location="$2"; shift 2 ;;
    --resource-group) group="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    --sku) sku="$2"; shift 2 ;;
    --runtime-only) runtime_only=true; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is missing. $2"; }
step() { printf '\n==> %s\n' "$*"; }

need node "Install Node.js 18 or later."
need npm "Install Node.js 18 or later."
need ffmpeg "Install it with: brew install ffmpeg"
need ffprobe "Install it with: brew install ffmpeg"

step "Installing the recording runtime in $runtime"
mkdir -p "$runtime"
[ -f "$runtime/package.json" ] || echo '{ "private": true }' > "$runtime/package.json"
# three and Fredoka render claymation scenes; rough.js and Caveat draw the chalkboard.
npm install --prefix "$runtime" --no-audit --no-fund --silent playwright@1 roughjs@4 @fontsource/caveat@5 \
  three@0.170 @fontsource/fredoka@5
# Inter labels diagrams and big text; xterm.js and JetBrains Mono draw terminal scenes.
npm install --prefix "$runtime" --no-audit --no-fund --silent @fontsource/inter@5 @xterm/xterm@5 @fontsource/jetbrains-mono@5
node "$runtime/node_modules/playwright/cli.js" install ffmpeg >/dev/null

# Microsoft's Azure architecture icons, for diagram scenes. Microsoft permits their use in
# architecture diagrams, training material and documentation. Re-downloaded only when it changes.
icons_page="https://learn.microsoft.com/en-us/azure/architecture/icons/"
icons_url=$(curl -fsSL "$icons_page" 2>/dev/null | grep -oE 'https://arch-center\.azureedge\.net/icons/[^"]+\.zip' | head -1 || true)
icons_url="${icons_url:-https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V25.zip}"
if [ "$(cat "$runtime/azure-icons/SOURCE" 2>/dev/null)" != "$icons_url" ]; then
  step "Downloading the Azure architecture icons"
  need unzip "Install unzip."
  tmp_zip="$(mktemp -t azure-icons.XXXXXX)"
  curl -fsSL -o "$tmp_zip" "$icons_url" || die "Could not download $icons_url (see $icons_page)."
  rm -rf "$runtime/azure-icons"
  mkdir -p "$runtime/azure-icons"
  unzip -q "$tmp_zip" -d "$runtime/azure-icons"
  rm -f "$tmp_zip"
  echo "$icons_url" > "$runtime/azure-icons/SOURCE"
fi
echo "Azure icons: $(find "$runtime/azure-icons" -name '*.svg' | wc -l | tr -d ' ') from $icons_url"
if [ ! -d "/Applications/Google Chrome.app" ] && ! command -v google-chrome >/dev/null 2>&1; then
  node "$runtime/node_modules/playwright/cli.js" install chromium
fi
echo "Playwright $(node -p "require('$runtime/node_modules/playwright/package.json').version") ready."

$runtime_only && exit 0

need az "Install the Azure CLI: https://aka.ms/azcli"
[ -n "$subscription" ] || die "--subscription is required (an Azure subscription ID or name)."

step "Resolving subscription and signed-in identity"
subscription_id=$(az account show --subscription "$subscription" --query id -o tsv) \
  || die "Subscription '$subscription' not found. Run: az login"
tenant=$(az account show --subscription "$subscription_id" --query tenantId -o tsv)
token=$(az account get-access-token --subscription "$subscription_id" --query accessToken -o tsv) \
  || die "Could not get a token. Run: az login --tenant $tenant"
# The object ID comes from the ARM token, so no Microsoft Graph permission is needed.
principal=$(node -e '
  const part = process.argv[1].split(".")[1];
  const claims = JSON.parse(Buffer.from(part, "base64url").toString());
  console.log(claims.oid);' "$token")
principal_type=$(node -e '
  const claims = JSON.parse(Buffer.from(process.argv[1].split(".")[1], "base64url").toString());
  console.log(claims.idtyp === "app" ? "ServicePrincipal" : "User");' "$token")
echo "Subscription $subscription_id, tenant $tenant, principal $principal ($principal_type)."

step "Deploying Azure AI Speech ($sku) to $group in $location"
az group create --subscription "$subscription_id" -n "$group" -l "$location" \
  --tags purpose=demo-narration -o none
params=(location="$location" sku="$sku" principalId="$principal" principalType="$principal_type")
[ -n "$name" ] && params+=(name="$name")
errors=$(mktemp); trap 'rm -f "$errors"' EXIT
if ! outputs=$(az deployment group create --subscription "$subscription_id" -g "$group" \
    -n narrated-demo -f "$skill/infra/main.bicep" -p "${params[@]}" \
    --query properties.outputs -o json 2>"$errors"); then
  if grep -q CanNotCreateMultipleFreeAccounts "$errors"; then
    existing=$(az cognitiveservices account list --subscription "$subscription_id" \
      --query "[?kind=='SpeechServices' && sku.name=='F0'].[name, resourceGroup]" -o tsv)
    die "This subscription already has a free (F0) Speech resource:
$existing
Adopt it:  setup.sh --subscription $subscription_id --name <name> --resource-group <group>
Or pay as you go:  setup.sh --subscription $subscription_id --sku S0"
  fi
  die "Deployment failed:
$(cat "$errors")"
fi

step "Writing $config"
mkdir -p "$(dirname "$config")"
node -e '
  const [outputs, subscription, tenant, file] = process.argv.slice(1);
  const o = JSON.parse(outputs);
  const config = { subscription, tenant, resourceId: o.resourceId.value, endpoint: o.endpoint.value,
    location: o.location.value };
  const fs = require("fs");
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  // Keep a voice the user already chose; otherwise leave it unset so the skill asks.
  if (previous.voice) config.voice = previous.voice;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  console.log(JSON.stringify(config, null, 2));' "$outputs" "$subscription_id" "$tenant" "$config"

step "Checking speech synthesis (a new role assignment can take a few minutes to apply)"
node "$skill/scripts/narrate.mjs" --check
