# Profile Management

Profiles in `ff-cli` store Docker registry authentication settings, allowing you to switch between different environments and registries without manually specifying credentials for each operation.

## Overview

Profiles are stored in `~/.ff/profiles` as an INI-formatted file. Each profile can be configured for different registry types:

- **Minikube**: Uses the local minikube Docker daemon (no remote registry)
- **GCP Artifact Registry**: Google Cloud Platform's container registry
- **Azure Container Registry**: Microsoft Azure's container registry
- **Standard**: Generic registries (Docker Hub, GHCR, etc.)

Profiles work seamlessly with [`ops` commands](ops.md) - when you run `ff-cli ops build`, it automatically uses your current profile for authentication.

## Basic Commands

### List Profiles

View all available profiles:

```bash
ff-cli profile list
```

This displays a table showing:
- Profile name
- Registry type (Minikube, GCP, Azure, Standard)
- Registry URL
- Current profile indicator (✓)

### Show Profile Details

View detailed information about a specific profile:

```bash
# Show current profile
ff-cli profile show

# Show specific profile
ff-cli profile show my-profile
```

For GCP profiles, this shows:
- Location (e.g., `us-central1`)
- Project ID
- Repository name
- Registry URL
- Service Account Key path

For other registry types, it shows:
- Registry URL
- Username
- Password (masked)

### Create a Profile

Create a new profile interactively:

```bash
# Interactive creation
ff-cli profile create my-profile

# Create with name inline
ff-cli profile create my-profile
```

The interactive flow will:
1. Prompt for profile name (if not provided)
2. Ask if you want to configure registry settings now
3. Present a menu to select registry type:
   - Minikube (no remote registry)
   - GCP Artifact Registry
   - Azure Container Registry
   - Other (Docker Hub, GHCR, etc.)

#### Registry Type Configuration

**Minikube**: No additional configuration needed. Uses local Docker daemon.

**GCP Artifact Registry**: You'll be prompted for:
- GCP region/location (e.g., `us-central1`)
- GCP Project ID
- Repository name
- Path to service account JSON key file

The registry URL is automatically constructed as `<location>-docker.pkg.dev`.

**Azure Container Registry**: You'll be prompted for:
- Registry URL (e.g., `myregistry.azurecr.io`)
- Username
- Password

**Standard Registry**: You'll be prompted for:
- Registry URL (e.g., `ghcr.io`, `docker.io`)
- Username (optional)
- Password (optional)

### Select Current Profile

Set which profile is active for operations:

```bash
# Interactive menu selection
ff-cli profile select

# Direct selection
ff-cli profile select my-profile
```

When no profile name is provided, an interactive menu appears showing all profiles with the current profile highlighted in FireFoundry orange.

### Edit a Profile

Modify an existing profile:

```bash
# Edit current profile
ff-cli profile edit

# Edit specific profile
ff-cli profile edit my-profile
```

This opens an interactive menu where you can update:
- Registry URL
- Username
- Password

For GCP profiles, editing is currently limited. Consider recreating the profile if you need to change GCP-specific settings.

### Delete a Profile

Remove a profile:

```bash
ff-cli profile delete my-profile

# Skip confirmation prompt
ff-cli profile delete my-profile --yes
```

## Profile Types

### Minikube Profile

Use this for local development with minikube. No remote registry is involved.

```bash
ff-cli profile create minikube-local
# Select "Minikube" when prompted
```

### GCP Artifact Registry Profile

For Google Cloud Platform's Artifact Registry:

```bash
ff-cli profile create gcp-dev
# Select "GCP Artifact Registry" when prompted
# Enter: us-central1, my-project, my-repo, /path/to/key.json
```

**Requirements:**
- GCP project with Artifact Registry enabled
- Service Account JSON key file with appropriate permissions
- The service account needs `Artifact Registry Writer` role

**Image Naming:**
When building images with a GCP profile, images are automatically tagged as:
```
<location>-docker.pkg.dev/<project-id>/<repository>/<image-name>:<tag>
```

For example: `us-central1-docker.pkg.dev/my-project/my-repo/my-bundle:1.0.0`

### Azure Container Registry Profile

For Microsoft Azure's Container Registry:

```bash
ff-cli profile create azure-prod
# Select "Azure Container Registry" when prompted
# Enter: myregistry.azurecr.io, username, password
```

### Standard Registry Profile

For Docker Hub, GitHub Container Registry (GHCR), or other standard registries:

```bash
ff-cli profile create dockerhub
# Select "Other" when prompted
# Enter: docker.io (or ghcr.io), username, password
```

## Usage with Operations

Profiles are automatically used by [`ops build`](ops.md#build-command) commands:

```bash
# Uses current profile automatically
ff-cli ops build my-bundle --tag 1.0.0

# Use specific profile
ff-cli ops build my-bundle --registry-profile gcp-dev --tag 1.0.0
```

When using a remote registry profile (GCP, Azure, Standard), the image is automatically pushed after building. For minikube profiles, the image stays local.

## Profile Storage

Profiles are stored in `~/.ff/profiles` as an INI file. Example:

```ini
[gcp-dev]
registry_type=GCP
gcp_location=us-central1
gcp_project_id=my-project
gcp_repository=my-repo
gcp_service_account_key_path=/path/to/key.json
profile_name=gcp-dev
current_profile=true

[minikube]
registry_type=Minikube
profile_name=minikube
```

## CI/CD Usage

In CI/CD environments, profiles are optional. Use the `--yes` flag with explicit registry flags:

```bash
ff-cli ops build my-bundle \
  --registry myregistry.io \
  --registry-username user \
  --registry-password pass \
  --yes \
  --push
```

When `--yes` is used, all required flags must be explicitly provided.

## Best Practices

1. **Name profiles by environment**: `gcp-dev`, `gcp-prod`, `azure-staging`
2. **Keep service account keys secure**: Store keys outside your project directory
3. **Use separate profiles for different projects**: Don't reuse credentials across projects
4. **Set current profile explicitly**: Use `ff-cli profile select` to avoid confusion
5. **Verify profile before use**: Run `ff-cli profile show` to confirm settings

## Troubleshooting

**Profile not found**: Ensure the profile exists with `ff-cli profile list`

**GCP authentication fails**: Verify the service account key path is correct and the key has proper permissions

**Registry URL incorrect**: For GCP, check that location, project ID, and repository are correct

**Profile not used**: Check current profile with `ff-cli profile show` or explicitly specify with `--registry-profile`

