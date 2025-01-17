const { Octokit } = require("@octokit/core");

require("dotenv").config();

const githubToken = process.env.GITHUB_TOKEN;
const projectId = process.env.PROJECT_ID;
const sourceFieldName = process.env.SOURCE_FIELD_NAME;
const targetFieldId = process.env.TARGET_FIELD_ID;
const dryRun = process.env.DRY_RUN;

const octokit = new Octokit({ auth: githubToken });

/**
 * Fetches all project item IDs and their titles for a given project.
 *
 * @param {string} projectId - The ID of the project to fetch items from.
 * @returns {Promise<Array<{ projectItemId: string, title: string }>>} A promise that resolves to an array of objects containing project item IDs and their titles.
 * @throws {Error} Throws an error if the GraphQL query fails.
 */
async function getProjectItemIds(projectId) {
  const query = `
        query ($projectId: ID!, $cursor: String) {
            node(id: $projectId) {
                ... on ProjectV2 {
                    items(first: 100, after: $cursor) {
                        pageInfo {
                            endCursor
                            hasNextPage
                        }
                        nodes {
                            id
                            content {
                                ... on Issue {
                                    number
                                    title
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

  let items = [];
  let cursor = null;
  let hasNextPage = true;

  try {
    while (hasNextPage) {
      const response = await octokit.graphql(query, { projectId, cursor });
      const newItems = response.node.items.nodes;
      items = items.concat(
        newItems.map((item) => ({
          projectItemId: item.id,
          title: item.content.title,
        }))
      );
      cursor = response.node.items.pageInfo.endCursor;
      hasNextPage = response.node.items.pageInfo.hasNextPage;
    }
    return items;
  } catch (error) {
    throw new Error(`Query failed: ${error.message}`);
  }
}

/**
 * Retrieves the ID and value of a single-select field in a GitHub project item.
 *
 * @param {string} projectItemId - The ID of the project item.
 * @param {string} fieldName - The name of the field to retrieve.
 * @returns {Promise<{sourceFieldId: string, sourceFieldValue: string}>} An object containing the field ID and value.
 * @throws {Error} If the query fails.
 */
async function getFieldIdAndValueOfSingleSelectField(projectItemId, fieldName) {
  const query = `
        query ($projectItemId: ID!, $fieldName: String!) {
            node(id: $projectItemId) {
                ... on ProjectV2Item {
                    fieldValueByName(name: $fieldName) {
                        ... on ProjectV2ItemFieldSingleSelectValue {
                            name
                            id
                        }
                    }
                }
            }
        }
    `;

  try {
    const response = await octokit.graphql(query, { projectItemId, fieldName });
    const fieldValue = response.node.fieldValueByName;
    if (!fieldValue) {
      return null;
    } else {
      return {
        sourceFieldId: fieldValue.id,
        sourceFieldValue: fieldValue.name,
      };
    }
  } catch (error) {
    throw new Error(`Query failed: ${error.message}`);
  }
}

/**
 * Updates the value of a specified field in a GitHub project item.
 *
 * @param {string} projectId - The ID of the GitHub project.
 * @param {string} projectItemId - The ID of the project item to update.
 * @param {string} fieldId - The ID of the field to update.
 * @param {string} value - The new value to set for the field.
 * @returns {Promise<void>} A promise that resolves when the field value is updated.
 * @throws {Error} Throws an error if the mutation fails.
 */
async function updateFieldValue(projectId, projectItemId, fieldId, value) {
  if (!value) {
    console.log(`No value to update for item ${projectItemId}`);
    return;
  }

  const mutation = `
        mutation ($projectId: ID!, $fieldId: ID!, $projectItemId: ID!, $value: String!) {
            updateProjectV2ItemFieldValue(
                input: { projectId: $projectId, fieldId: $fieldId, itemId: $projectItemId, value: { text: $value } }
            ) {
                projectV2Item {
                    id
                }
            }
        }
    `;

  try {
    await octokit.graphql(mutation, {
      projectId,
      fieldId,
      projectItemId,
      value,
    });
    console.log(`Field value updated for item ${projectItemId} to: ${value}`);
  } catch (error) {
    throw new Error(`Mutation failed: ${error.message}`);
  }
}

/**
 * Main function to migrate single select field to text field
 *
 * 1. Get all project items
 * 2. Get the value of single select field
 * 3. Update the text field with the value of single select field
 */
(async () => {
  if (dryRun) {
    console.log("==== Dry Run Mode ====");
  }

  try {
    // Step 1: Get all project items
    const items = await getProjectItemIds(projectId);
    console.log("\nFetched project items");
    console.log(items);

    // Step 2: Get the value of the single select field for each item
    console.log(`\nFetching values for field: ${sourceFieldName}`);
    for (const item of items) {
      console.log(`  Item ${items.indexOf(item) + 1} of ${items.length}`);

      const fieldData = await getFieldIdAndValueOfSingleSelectField(item.projectItemId, sourceFieldName);

      if (fieldData) {
        item.sourceFieldId = fieldData.sourceFieldId;
        item.sourceFieldValue = fieldData.sourceFieldValue;
      } else {
        console.log(`  No value found for item ${item.projectItemId}`);
        items.splice(items.indexOf(item), 1); // Remove item if no field value found
      }
    }

    // Step 3: Update the text field with the value of the single select field
    console.log(`\nUpdating field value for field ID: ${targetFieldId}`);
    for (const item of items) {
      if (!dryRun) {
        console.log(`  Updating field value for item ${items.indexOf(item) + 1} of ${items.length}`);
        await updateFieldValue(projectId, item.projectItemId, targetFieldId, item.sourceFieldValue);
      } else {
        console.log(`  Dry run: Would have updated field value for item ${item.projectItemId} to: ${item.sourceFieldValue}`);
      }
    }
  } catch (error) {
    console.error("! Error during migration:", error);
  }
})();
