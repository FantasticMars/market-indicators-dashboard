# GitHub Desktop Setup

This project should be published as a private GitHub repository.

## Recommended Repository

- Repository name: `market-indicators-dashboard`
- Visibility: Private
- Local project folder: `market-indicators-dashboard`

## First-Time GitHub Desktop Flow

1. Open GitHub Desktop and sign in.
2. Choose `File > Add Local Repository`.
3. Select this folder:

   ```text
   /Users/yz/Library/CloudStorage/OneDrive-个人/0.0 Documents/3.0 Investments/0 Stock Analysis/market-indicators-dashboard
   ```

4. Review the changed files.
5. Commit message:

   ```text
   Prepare dashboard for cloud deployment
   ```

6. Click `Commit to main`.
7. Click `Publish repository`.
8. Confirm `Keep this code private` is selected.

## Ongoing Workflow

After future edits:

1. Review changed files in GitHub Desktop.
2. Commit with a short description.
3. Click `Push origin`.
4. The cloud platform can then redeploy from GitHub.

## Files Intentionally Not Published

The `.gitignore` excludes:

- `market-history.json`: local generated score history
- `__pycache__/`: Python cache
- `.env`: local secrets
- `config.local.js`: optional local-only frontend overrides
