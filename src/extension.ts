import * as vscode from "vscode";

import {
  parseFeatureFile,
  runScenario,
  runFeature,
  runAllTests,
  findTestItemByScenarioName,
  findTestItemByFeatureName,
  CucumberCodeLensProvider,
} from "./wdio-cucumber";

let testController: vscode.TestController;

export function activate(context: vscode.ExtensionContext) {
  // Create a Test Controller for Cucumber Tests
  testController = vscode.tests.createTestController(
    "cucumberTestController",
    "Cucumber Tests"
  );
  context.subscriptions.push(testController);

  // Find all .feature files in the workspace and parse them
  vscode.workspace.findFiles("**/*.feature", 'node_modules/**').then((files) => {
    files.forEach((file) => {
      parseFeatureFile(file, testController);
    });
  });

  // Re-parse files on save
  vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.languageId === "feature") {
      parseFeatureFile(document.uri, testController);
    }
  });

  const runScenarioDisposable = vscode.commands.registerCommand(
    "extension.runScenario",
    (document: vscode.TextDocument, line: vscode.TextLine) => {
      // Extract from document the Feature name
      const lines = document.getText().split("\n");

      // find the feature name
      let featureName = "";
      for (const line of lines) {
        if (line.startsWith("Feature:")) {
          featureName = line.replace("Feature: ", "").trim();
          break;
        }
      }

      const scenarioName = line.text.trim();
      vscode.window.showInformationMessage(`Running Scenario: ${scenarioName}`);

      // Find the corresponding test item in the TestController
      const testItem = findTestItemByScenarioName(
        testController,
        featureName,
        scenarioName
      );

      if (testItem) {
        runScenario(testController, testItem); // Run the scenario and report the result to TestController
      }
    }
  );

  context.subscriptions.push(runScenarioDisposable);

  const debugScenarioDisposable = vscode.commands.registerCommand(
    "extension.debugScenario",
    (document: vscode.TextDocument, line: vscode.TextLine) => {
      // Extract from document the Feature name
      const featureName = document
        .getText()
        .split("\n")[0]
        .replace("Feature: ", "");

      const scenarioName = line.text.trim();
      vscode.window.showInformationMessage(
        `Debugging Scenario: ${scenarioName}`
      );

      // Find the corresponding test item in the TestController
      const testItem = findTestItemByScenarioName(
        testController,
        featureName,
        scenarioName
      );
      if (testItem) {
        runScenario(testController, testItem, true); // Run in debug mode
      }
    }
  );

  context.subscriptions.push(debugScenarioDisposable);

  const runFeatureDisposable = vscode.commands.registerCommand(
    "extension.runFeature",
    (document: vscode.TextDocument, line: vscode.TextLine) => {
      const featureName = line.text.trim();
      vscode.window.showInformationMessage(`Running Feature: ${featureName}`);

      // Find the corresponding test item (feature) in the TestController
      const testItem = findTestItemByFeatureName(testController, featureName);

      if (testItem) {
        runFeature(testController, testItem); // Run the feature and report the result to the TestController
      }
    }
  );
  context.subscriptions.push(runFeatureDisposable);

  // Register a CodeLens provider for .feature files
  const codeLensGherkindisposable = vscode.languages.registerCodeLensProvider(
    { language: "gherkin" },
    new CucumberCodeLensProvider()
  );

  context.subscriptions.push(codeLensGherkindisposable);

  const codeLensCucumberdisposable = vscode.languages.registerCodeLensProvider(
    { language: "cucumber" },
    new CucumberCodeLensProvider()
  );

  context.subscriptions.push(codeLensCucumberdisposable);

  // Set up the run handler for the test controller
  testController.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    async (request, _token) => {
      if (!request.include) {
        runAllTests(testController);
      }

      let testItem: vscode.TestItem | undefined;
      let type: string | undefined;

      request.include?.forEach((item) => {
        if (item.label.startsWith("Scenario:")) {
          type = "Scenario";
          testItem = item;
        }

        if (item.label.startsWith("Feature:")) {
          type = "Feature";
          testItem = item;
        }
      });

      if (testItem && type === "Feature") {
        await runFeature(testController, testItem);
      }

      if (testItem && type === "Scenario") {
        await runScenario(testController, testItem);
      }
    },
    true
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
