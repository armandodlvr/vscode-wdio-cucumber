import * as vscode from "vscode";
import { spawn } from "child_process";

export const runCommand = (cmd: string, cwd: string, run: vscode.TestRun) => {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, [], { cwd, shell: true });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += `${data.toString()}\r\n`;
      console.log(`stdout: ${data}`);
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
      console.error(`stderr: ${data}`);
    });

    child.on("close", (code) => {
      if (code === 0 || code === 1) {
        parseAndDisplayStdout(stdout, run);
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on("error", (error) => {
      reject(error);
    });
  });
};

// Assuming `stdout` is a string containing the entire output
function parseAndDisplayStdout(stdout: string, run: vscode.TestRun) {
  const lines = stdout.split("\n");

  lines.forEach((line) => {
    // Append each line to the test run's output
    run.appendOutput(line + "\r\n");
  });

  // Optionally, parse the final line to determine the test results (e.g., "7 passing (1.3s)")
  const finalResult = lines[lines.length - 1].match(/(\d+) passing/);
  if (finalResult) {
    const passingTests = parseInt(finalResult[1], 10);
    console.log(`${passingTests} tests passed`);
  }
}
