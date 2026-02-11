# Azure Deployment Guide

Complete guide for deploying PerfSimNode to Azure App Service using GitHub Actions with OIDC authentication.

## Overview

This guide covers:
1. Creating an Azure App Service for Node.js
2. Setting up Azure AD App Registration for GitHub OIDC
3. Configuring federated credentials
4. Setting up GitHub repository secrets
5. Deploying via GitHub Actions

## Prerequisites

- Azure subscription with permissions to create resources
- Azure AD/Entra ID permissions to create App Registrations
- GitHub account
- Azure CLI installed (optional, for CLI method)

## Step 1: Create Azure App Service

### Option A: Azure Portal

1. **Navigate to App Services**
   - Go to [Azure Portal](https://portal.azure.com)
   - Search for "App Services" and select it
   - Click **+ Create**

2. **Configure Basics**
   
   | Setting | Value |
   |---------|-------|
   | Subscription | Your subscription |
   | Resource Group | Create new or use existing |
   | Name | `perfsimnode` (or your preferred name) |
   | Publish | Code |
   | Runtime stack | **Node 24 LTS** |
   | Operating System | **Linux** |
   | Region | Your preferred region |

3. **Configure App Service Plan**
   
   | Setting | Recommendation |
   |---------|---------------|
   | SKU | **Basic B1** or higher (for WebSocket support) |
   
   > ⚠️ **Important:** The Free (F1) tier does not support WebSockets which are required for real-time dashboard updates.

4. **Review and Create**
   - Click **Review + create**
   - Click **Create**

### Option B: Azure CLI

```bash
# Login to Azure
az login

# Set variables
RESOURCE_GROUP="perfsimnode-rg"
APP_NAME="perfsimnode"
LOCATION="eastus"
APP_SERVICE_PLAN="perfsimnode-plan"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create App Service Plan (B1 for WebSocket support)
az appservice plan create \
  --name $APP_SERVICE_PLAN \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku B1 \
  --is-linux

# Create Web App with Node.js 24
az webapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --plan $APP_SERVICE_PLAN \
  --runtime "NODE:24-lts"
```

### Configure App Settings

After creation, configure the following application settings:

```bash
# Via Azure CLI
az webapp config appsettings set \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --settings \
    WEBSITE_NODE_DEFAULT_VERSION="~24" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="false"
```

Or via Portal:
1. Go to your App Service → **Configuration** → **Application settings**
2. Add:
   - `WEBSITE_NODE_DEFAULT_VERSION` = `~24`
   - `SCM_DO_BUILD_DURING_DEPLOYMENT` = `false` (we pre-build in GitHub Actions)

### Enable WebSockets

1. Go to your App Service → **Configuration** → **General settings**
2. Set **Web sockets** to **On**
3. Click **Save**

Or via CLI:
```bash
az webapp config set \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --web-sockets-enabled true
```

## Step 2: Create Azure AD App Registration

GitHub Actions uses OpenID Connect (OIDC) to authenticate with Azure without storing credentials. This requires an App Registration with federated credentials.

### Create the App Registration

1. **Navigate to App Registrations**
   - Go to [Azure Portal](https://portal.azure.com)
   - Search for "App registrations" and select it
   - Click **+ New registration**

2. **Configure Registration**
   
   | Setting | Value |
   |---------|-------|
   | Name | `github-perfsimnode-deploy` |
   | Supported account types | Accounts in this organizational directory only |
   | Redirect URI | Leave empty |

3. **Click Register**

4. **Record the IDs** (you'll need these for GitHub secrets)
   
   From the **Overview** page, copy:
   - **Application (client) ID** → This is `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → This is `AZURE_TENANT_ID`

### Get Subscription ID

1. Go to **Subscriptions** in the Azure Portal
2. Select your subscription
3. Copy the **Subscription ID** → This is `AZURE_SUBSCRIPTION_ID`

## Step 3: Configure Federated Credentials

Federated credentials allow GitHub Actions to authenticate without storing secrets.

1. **Navigate to your App Registration**
   - Go to **Certificates & secrets**
   - Select **Federated credentials** tab
   - Click **+ Add credential**

2. **Configure the Credential**
   
   | Setting | Value |
   |---------|-------|
   | Federated credential scenario | **GitHub Actions deploying Azure resources** |
   | Organization | Your GitHub username or organization |
   | Repository | `PerfSimNode` (your repo name) |
   | Entity type | **Branch** |
   | GitHub branch name | `main` |
   | Name | `github-main-branch` |

3. **Click Add**

> **Note:** If you also want to deploy from pull requests or other branches, add additional federated credentials with the appropriate entity type.

### Alternative: Add Credential via CLI

```bash
# Get the App Registration Object ID (different from Client ID)
APP_OBJECT_ID=$(az ad app show --id $AZURE_CLIENT_ID --query id -o tsv)

# Create federated credential
az ad app federated-credential create \
  --id $APP_OBJECT_ID \
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:YOUR_GITHUB_USERNAME/PerfSimNode:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

## Step 4: Grant Azure Permissions

The App Registration needs permission to deploy to your App Service.

### Assign Contributor Role to App Service

1. **Navigate to your App Service**
   - Go to **Access control (IAM)**
   - Click **+ Add** → **Add role assignment**

2. **Configure Role Assignment**
   
   | Setting | Value |
   |---------|-------|
   | Role | **Contributor** |
   | Assign access to | User, group, or service principal |
   | Members | Search for `github-perfsimnode-deploy` (your App Registration name) |

3. **Click Review + assign**

### Alternative: Assign via CLI

```bash
# Get the App Service resource ID
APP_SERVICE_ID=$(az webapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query id -o tsv)

# Get the App Registration Service Principal ID
SP_ID=$(az ad sp show --id $AZURE_CLIENT_ID --query id -o tsv)

# Assign Contributor role
az role assignment create \
  --assignee $SP_ID \
  --role "Contributor" \
  --scope $APP_SERVICE_ID
```

## Step 5: Configure GitHub Repository

### Fork or Clone the Repository

1. **Fork the Repository**
   - Go to the [PerfSimNode repository](https://github.com/rhamlett/PerfSimNode)
   - Click **Fork** to create your own copy

   Or **Clone and Push**:
   ```bash
   git clone https://github.com/rhamlett/PerfSimNode.git
   cd PerfSimNode
   git remote set-url origin https://github.com/YOUR_USERNAME/PerfSimNode.git
   git push -u origin main
   ```

### Add GitHub Secrets

1. **Navigate to Repository Settings**
   - Go to your repository on GitHub
   - Click **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**

2. **Add the Following Secrets**

   | Secret Name | Value | Description |
   |-------------|-------|-------------|
   | `AZURE_CLIENT_ID` | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | App Registration Client ID |
   | `AZURE_TENANT_ID` | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | Azure AD Directory/Tenant ID |
   | `AZURE_SUBSCRIPTION_ID` | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | Azure Subscription ID |

   > **Note:** Do NOT add a client secret. OIDC federated credentials eliminate the need for secrets.

### Update Workflow Configuration (if needed)

If your App Service name is different from `perfsimnode`, update the workflow file:

1. Edit `.github/workflows/deploy.yml`
2. Change the `AZURE_WEBAPP_NAME` environment variable:
   ```yaml
   env:
     AZURE_WEBAPP_NAME: your-app-service-name  # Change this
     NODE_VERSION: '24'
   ```
3. Commit and push the change

## Step 6: Deploy

### Automatic Deployment

Deployment triggers automatically when you push to the `main` branch:

```bash
git add .
git commit -m "Your changes"
git push origin main
```

### Manual Deployment

You can also trigger deployment manually:

1. Go to your repository on GitHub
2. Click **Actions** tab
3. Select **Deploy to Azure App Service**
4. Click **Run workflow** → **Run workflow**

### Monitor Deployment

1. Go to **Actions** tab in your repository
2. Click on the running workflow
3. Watch the build and deployment progress

## Step 7: Verify Deployment

### Check the Application

1. **Open the App URL**
   ```
   https://<your-app-name>.azurewebsites.net
   ```

2. **Verify Dashboard**
   - Real-time metrics should update
   - WebSocket connection should show "Connected"

3. **Test Health Endpoint**
   ```bash
   curl https://<your-app-name>.azurewebsites.net/api/health
   ```

### Check Logs (if issues)

```bash
# View deployment logs
az webapp log deployment show --name $APP_NAME --resource-group $RESOURCE_GROUP

# Stream live logs
az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP
```

Or in the Portal:
1. Go to your App Service → **Deployment Center** → **Logs**
2. Go to **Log stream** for live application logs

## Troubleshooting

### WebSocket Connection Fails

**Symptoms:** Dashboard shows "Disconnected", charts don't update

**Solutions:**
1. Ensure WebSockets are enabled in App Service Configuration
2. Upgrade from Free tier to Basic or higher
3. Check if ARR Affinity is enabled (Settings → Configuration → General settings)

### OIDC Authentication Fails

**Symptoms:** GitHub Actions fails at "Login to Azure" step

**Check:**
1. Verify all three secrets are set correctly
2. Confirm federated credential subject matches your repo/branch:
   - Must be `repo:USERNAME/REPO:ref:refs/heads/main`
3. Ensure App Registration has Contributor role on the App Service

### Application Crashes on Startup

**Symptoms:** App shows "Application Error" or doesn't respond

**Check:**
1. View Log stream in Azure Portal
2. Ensure startup command is correct (should auto-detect from package.json)
3. Verify Node.js version matches (24 LTS)

### Build Fails in GitHub Actions

**Symptoms:** Workflow fails at build or test step

**Check:**
1. Review the Actions log for specific errors
2. Ensure all dependencies are in package.json
3. Run `npm ci && npm run build && npm test` locally to verify

## Security Considerations

### OIDC Benefits

- **No stored secrets:** Credentials are exchanged via token, nothing stored in GitHub
- **Short-lived tokens:** Tokens expire quickly, reducing exposure window
- **Scoped access:** Federated credentials are scoped to specific repos/branches

### Recommended Practices

1. **Scope permissions narrowly:**
   - Assign Contributor only to the specific App Service, not the whole subscription

2. **Use branch protection:**
   - Require PR reviews before merging to main
   - Enable branch protection rules in GitHub

3. **Audit regularly:**
   - Review App Registration permissions periodically
   - Check Azure Activity Log for deployment events

## Quick Reference

### IDs to Collect

| ID | Where to Find | GitHub Secret Name |
|----|---------------|-------------------|
| Client ID | App Registration → Overview | `AZURE_CLIENT_ID` |
| Tenant ID | App Registration → Overview | `AZURE_TENANT_ID` |
| Subscription ID | Subscriptions blade | `AZURE_SUBSCRIPTION_ID` |

### Azure CLI One-Liner Summary

```bash
# Full setup (customize variables at top)
RESOURCE_GROUP="perfsimnode-rg"
APP_NAME="perfsimnode"
LOCATION="eastus"
GITHUB_REPO="YOUR_USERNAME/PerfSimNode"

# Create resources
az group create -n $RESOURCE_GROUP -l $LOCATION
az appservice plan create -n "${APP_NAME}-plan" -g $RESOURCE_GROUP -l $LOCATION --sku B1 --is-linux
az webapp create -n $APP_NAME -g $RESOURCE_GROUP -p "${APP_NAME}-plan" --runtime "NODE:24-lts"
az webapp config set -n $APP_NAME -g $RESOURCE_GROUP --web-sockets-enabled true

# Create App Registration and get IDs
APP_ID=$(az ad app create --display-name "github-${APP_NAME}-deploy" --query appId -o tsv)
az ad sp create --id $APP_ID
TENANT_ID=$(az account show --query tenantId -o tsv)
SUB_ID=$(az account show --query id -o tsv)

# Create federated credential
az ad app federated-credential create --id $APP_ID --parameters "{
  \"name\": \"github-main-branch\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${GITHUB_REPO}:ref:refs/heads/main\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}"

# Assign permissions
APP_SERVICE_ID=$(az webapp show -n $APP_NAME -g $RESOURCE_GROUP --query id -o tsv)
az role assignment create --assignee $APP_ID --role Contributor --scope $APP_SERVICE_ID

# Output secrets for GitHub
echo "AZURE_CLIENT_ID=$APP_ID"
echo "AZURE_TENANT_ID=$TENANT_ID"
echo "AZURE_SUBSCRIPTION_ID=$SUB_ID"
```

## Next Steps

After deployment:
1. Access the dashboard at `https://<app-name>.azurewebsites.net`
2. Review the [Azure Diagnostics Guide](/azure-diagnostics.html) for troubleshooting simulations
3. Read the [simulation documentation](./simulations/) for detailed guides on each simulation type
