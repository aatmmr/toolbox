# Migrate a Single Select field to a Text Field in GitHub Projects

This script moves the content of a single select field to a text field in a GitHub Project. Only existing values will be moved to the text field.
The script provides a dry-run mode to test the migration before actually moving the content. The console provides some feedback on the progress and the number of items that will be updated.

## Usage

### Prepare Parameters

A few parameter are required to get started, namely:

- `GITHUB_TOKEN`: A GitHub Personal Access Token (PAT) with the required permissions (`project`, `repo`)
- `PROJECT_ID`: The ID of the project to work on (get via GraphQL)
- `SOURCE_FIELD_NAME`: The name of the field to migrate the content from (column name in project)
- `TARGET_FIELD_ID`: The ID of the field to migrate the content to (get via GraphQL)

### Use the Script

1. Run `npm i` in the root of the repository (installs all required dependencies)
2. Create a `.env` file in the root of the repository with the following content:

    ```env
    GITHUB_TOKEN=your_github_token
    PROJECT_ID=your_project_id
    SOURCE_FIELD_NAME=your_source_field_name
    TARGET_FIELD_ID=your_target_field_id
    DRY_MODE=true
    ```

3. Run `node migrate-single-select-to-text-field.js` from this folder
