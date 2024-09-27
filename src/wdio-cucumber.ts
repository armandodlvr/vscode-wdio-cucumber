import * as path from "path";
import * as vscode from "vscode";
import * as fs from 'fs';
// import { promises as fs } from "fs";
import {
  Parser,
  AstBuilder,
  GherkinClassicTokenMatcher,
} from "@cucumber/gherkin";
import * as messages from "@cucumber/messages";

import { runCommand } from "./util";

// Function to parse a feature file and return test items (Feature, Scenario, Steps)
export async function parseFeatureFile(
  fileUri: vscode.Uri,
  testController: vscode.TestController
) {
  const fileContent = (await vscode.workspace.fs.readFile(fileUri)).toString();

  // Set up a Gherkin parser with the necessary components
  const matcher = new GherkinClassicTokenMatcher();
  const parser = new Parser(
    new AstBuilder(messages.IdGenerator.uuid()),
    matcher
  );
  const gherkinDocument = parser.parse(fileContent);

  // Extract the feature from the Gherkin document
  const feature = gherkinDocument.feature;
  if (!feature) {
    console.error("No feature found in the document");
    return;
  }

  // Create a TestItem for the feature
  const featureTestItem = testController.createTestItem(
    feature.name,
    `Feature: ${feature.name}`,
    fileUri
  );

  testController.items.add(featureTestItem);

  // Loop through the feature's children (scenarios and background)
  feature.children.forEach((child) => {
    if (child.scenario) {
      const scenario = child.scenario;

      // Create a TestItem for each scenario
      const scenarioTestItem = testController.createTestItem(
        scenario.name,
        `Scenario: ${scenario.name}`,
        fileUri
      );
      featureTestItem.children.add(scenarioTestItem);

      // Add steps to the scenario
      scenario.steps.forEach((step) => {
        const stepTestItem = testController.createTestItem(
          step.text,
          `Step: ${step.keyword} ${step.text}`,
          fileUri
        );
        scenarioTestItem.children.add(stepTestItem);
      });
    }
  });
}

export async function runScenario(
  testController: vscode.TestController,
  testItem: vscode.TestItem,
  debugMode = false
) {
  const run = testController.createTestRun(
    new vscode.TestRunRequest([testItem])
  );

  // Clear previous test results
  run.enqueued(testItem);
  run.started(testItem);

  try {
    const fileUri = testItem.uri;

    if (!fileUri) {
      throw new Error("No file URI found for the feature");
    }

    // Extract the directory path from the fileUri
    const filePath = fileUri.fsPath;
    const directoryPath = path.resolve(path.dirname(filePath), "..", "..");

    // Extract the relative path from the fileUri
    const relativePath = vscode.workspace.asRelativePath(fileUri);

    const fileContent = (
      await vscode.workspace.fs.readFile(fileUri)
    ).toString();

    // Set up a Gherkin parser with the necessary components
    const matcher = new GherkinClassicTokenMatcher();
    const parser = new Parser(
      new AstBuilder(messages.IdGenerator.uuid()),
      matcher
    );
    const gherkinDocument = parser.parse(fileContent);

    let location = 1;

    gherkinDocument.feature?.children.forEach((child) => {
      if (child.scenario) {
        const scenario = child.scenario;
        if (scenario.name === testItem.id) {
          location = scenario.location.line;
        }
      }
    });

    // Clear the .tmp/json folder
    const reportDir = path.join(directoryPath, ".tmp/json");
    await clearReportFolder(reportDir);

    const wdioConfigFile = findConfigFile(directoryPath, 'wdio.conf.ts');

    const command = `npx wdio run ${wdioConfigFile} --spec ${relativePath}:${location}`;
    await runWdioCommand(command, directoryPath, run);

    const reportFiles = await fs.promises.readdir(reportDir);

    for (const reportFile of reportFiles) {
      const reportFilePath = path.join(reportDir, reportFile);
      const reportContent = await fs.promises.readFile(reportFilePath, "utf8");
      const report = JSON.parse(reportContent);

      // Update test results based on the report
      updateTestResults(report, testItem, run);
    }

    // await runCucumberTest(testItem, run, debugMode)
    run.passed(testItem); // Report as passed
  } catch (error) {
    run.failed(testItem, new vscode.TestMessage((error as Error).message)); // Report as failed
    throw error; // Propagate the error to indicate that the scenario has failed
  } finally {
    run.end(); // Ensure the test run is ended
  }
}

// Helper function to find the corresponding TestItem by scenario name
export function findTestItemByScenarioName(
  testController: vscode.TestController,
  featureName: string,
  scenarioName: string
): vscode.TestItem | undefined {
  // Iterate through the testController items to find the specific feature
  let foundScenario: vscode.TestItem | undefined = undefined;

  testController.items.forEach((featureTestItem) => {
    if (featureTestItem.label === `Feature: ${featureName}`) {
      // Once the feature is found, get the scenario from the feature's children
      featureTestItem.children.forEach((scenarioTestItem) => {
        if (scenarioTestItem.label === scenarioName) {
          foundScenario = scenarioTestItem;
        }
      });
    }
  });

  if (!foundScenario) {
    console.error(`Scenario not found: ${scenarioName}`);

    return undefined;
  }

  return foundScenario; // Find the TestItem by name
}

export function findTestItemByFeatureName(
  testController: vscode.TestController,
  featureName: string
): vscode.TestItem | undefined {
  // Iterate through the testController items to find the specific feature
  let foundFeature: vscode.TestItem | undefined = undefined;

  testController.items.forEach((featureTestItem) => {
    if (featureTestItem.label === featureName) {
      foundFeature = featureTestItem;
    }
  });

  return foundFeature;
}

export async function runFeature(
  testController: vscode.TestController,
  featureTestItem: vscode.TestItem,
  debugMode = false
) {
  const run = testController.createTestRun(
    new vscode.TestRunRequest([featureTestItem])
  );

  // Clear previous test results
  run.enqueued(featureTestItem);
  run.started(featureTestItem);

  try {
    const fileUri = featureTestItem.uri;

    if (!fileUri) {
      throw new Error("No file URI found for the feature");
    }

    // Extract the directory path from the fileUri
    const filePath = fileUri.fsPath;
    const directoryPath = path.resolve(path.dirname(filePath), "..", "..");

    // Clear the .tmp/json folder
    const reportDir = path.join(directoryPath, ".tmp/json");
    await clearReportFolder(reportDir);

    // Extract the relative path from the fileUri
    const relativePath = vscode.workspace.asRelativePath(fileUri);

    const wdioConfigFile = findConfigFile(directoryPath, 'wdio.conf.ts');

    const command = `npx wdio run ${wdioConfigFile} --spec ${relativePath}`;
    await runWdioCommand(command, directoryPath, run);

    const reportFiles = await fs.promises.readdir(reportDir);

    for (const reportFile of reportFiles) {
      const reportFilePath = path.join(reportDir, reportFile);
      const reportContent = await fs.promises.readFile(reportFilePath, "utf8");
      const report = JSON.parse(reportContent);

      // Update test results based on the report
      await updateTestResults(report, featureTestItem, run);
    }
    run.passed(featureTestItem); // Mark the feature as passed if all scenarios pass
  } catch (error) {
    run.failed(
      featureTestItem,
      new vscode.TestMessage((error as Error).message)
    );
  } finally {
    run.end(); // Ensure the test run is ended
  }
}

export class CucumberCodeLensProvider implements vscode.CodeLensProvider {
  // Method to provide the CodeLens actions
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];

    // Iterate through the lines of the document and look for 'Feature' or 'Scenario'
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);

      if (line.text.trimStart().startsWith("Feature:")) {
        // Add CodeLens for running the entire feature
        codeLenses.push(
          new vscode.CodeLens(line.range, {
            title: "$(play) Run Feature",
            command: "extension.runFeature",
            arguments: [document, line],
          })
        );
        codeLenses.push(
          new vscode.CodeLens(line.range, {
            title: "$(bug) Debug Feature",
            command: "extension.runFeature",
            arguments: [document, line],
          })
        );
      }

      // Check for a "Scenario:" keyword to add CodeLens
      if (line.text.trimStart().startsWith("Scenario:")) {
        const range = line.range;

        // Add a "Run" and a "Debug" CodeLens action for each scenario
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: "$(play) Run Scenario", // Play icon for running
            command: "extension.runScenario",
            arguments: [document, line],
          })
        );
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: "$(bug) Debug Scenario", // Bug icon for debugging
            command: "extension.debugScenario",
            arguments: [document, line],
          })
        );
      }
    }
    return codeLenses;
  }
}

async function updateTestResults(
  report: any[],
  featureTestItem: vscode.TestItem,
  run: vscode.TestRun
) {
  // Loop through all features in the report
  for (const feature of report) {
    if (
      feature.type === "feature" &&
      feature.uri === featureTestItem.uri?.fsPath
    ) {
      // Check if featureTestItem is a Feature or a Scenario
      if (featureTestItem.label === `Feature: ${feature.name}`) {
        // Loop through all scenarios (elements) of the feature
        for (const scenario of feature.elements) {
          const scenarioTestItem = featureTestItem.children.get(scenario.name);
          if (scenarioTestItem) {
            let scenarioPassed = true;

            // Loop through all steps of the scenario
            for (const step of scenario.steps) {
              const stepTestItem = scenarioTestItem.children.get(step.name);

              if (stepTestItem) {
                if (step.result.status === "passed") {
                  run.passed(stepTestItem);
                } else if (step.result.status === "failed") {
                  scenarioPassed = false;
                  run.failed(
                    stepTestItem,
                    new vscode.TestMessage(
                      step.result.error_message || "Step failed"
                    )
                  );
                }
              }
            }

            if (scenarioPassed) {
              run.passed(scenarioTestItem);
            } else {
              run.failed(
                scenarioTestItem,
                new vscode.TestMessage("Scenario failed")
              );
            }
          }
        }
      } else {
        // Update the scenario test item
        feature.elements.forEach((scenario: any) => {
          if (featureTestItem.label === `Scenario: ${scenario.name}`) {
            let scenarioPassed = true;

            // Loop through all steps of the scenario
            scenario.steps.forEach((step: any) => {
              const stepTestItem = featureTestItem.children.get(step.name);

              if (stepTestItem) {
                if (step.result.status === "passed") {
                  run.passed(stepTestItem);
                } else if (step.result.status === "failed") {
                  scenarioPassed = false;
                  run.failed(
                    stepTestItem,
                    new vscode.TestMessage(
                      step.result.error_message || "Step failed"
                    )
                  );
                }
              }
            });

            if (scenarioPassed) {
              run.passed(featureTestItem);
            } else {
              run.failed(
                featureTestItem,
                new vscode.TestMessage("Scenario failed")
              );
            }
          }
        });
      }
    }
  }
}

// Function to clear the .tmp/json folder
async function clearReportFolder(reportDir: string): Promise<void> {
  try {
    const files = await fs.promises.readdir(reportDir);
    for (const file of files) {
      await fs.promises.unlink(path.join(reportDir, file));
    }
  } catch (error) {
    // Handle error if the directory does not exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function runAllTests(testController: vscode.TestController) {
  // Iterate over all test items in the request
  const featuresTestItems: vscode.TestItem[] = [];

  testController.items.forEach((feature) => {
    featuresTestItems.push(feature);
  });

  const run = testController.createTestRun(
    new vscode.TestRunRequest(undefined)
  );

  let folderPath: string | undefined;

  // Clear the .tmp/json folder
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      folderPath = folder.uri.fsPath;
      const reportDir = path.join(folderPath, ".tmp/json");
      await clearReportFolder(reportDir);
    }
  }

  testController.items.forEach((feature) => {
    run.enqueued(feature);
    run.started(feature);

    // run.enqueued also for the children
    feature.children.forEach((scenario) => {
      run.enqueued(scenario);
      run.started(scenario);

      scenario.children.forEach((step) => {
        run.enqueued(step);
        run.started(step);
      });
    });
  });

  if (!folderPath) {
    throw new Error("No workspace folder");
  }

  try {
    const command = `npx wdio run wdio.BUILD.conf.ts`;
    await runWdioCommand(command, folderPath, run);
  } catch (e) {
    console.log(e);
  }

  // Read all report files in the directory
  const reportDir = path.join(folderPath, ".tmp/json");
  const reportFiles = await fs.promises.readdir(reportDir);

  for (const testItem of featuresTestItems) {
    // const interRun = testController.createTestRun(
    //   new vscode.TestRunRequest([testItem])
    // )

    for (const reportFile of reportFiles) {
      const reportFilePath = path.join(reportDir, reportFile);
      const reportContent = await fs.promises.readFile(reportFilePath, "utf8");
      const report = JSON.parse(reportContent);

      // Update test results based on the report
      try {
        await updateTestResults(report, testItem, run);
        run.passed(testItem); // Mark the test item as passed if all scenarios pass
      } catch (error) {
        run.failed(testItem, new vscode.TestMessage((error as Error).message));
      }
    }

    // interRun.end() // Ensure the test run is ended
  }

  run.end(); // Ensure the test run is ended
}

async function runWdioCommand(
  command: string,
  folderPath: string,
  run: vscode.TestRun
) {
  try {
    await runCommand(command, folderPath, run);
    vscode.window.showInformationMessage("WDIO command executed successfully.");
  } catch (error) {
    console.error("Error executing command:", error);
    vscode.window.showErrorMessage(
      `Error executing WDIO command: ${(error as Error).message}`
    );
  }
}

function findConfigFile(dir: string, fileName: string): string | null {
  const files = fs.readdirSync(dir);
  for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
          const result = findConfigFile(fullPath, fileName);
          if (result) {
              return result;
          }
      } else if (file === fileName) {
          return fullPath;
      }
  }
  return null;
}