import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as path from 'node:path';

function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		cp.exec(command, options, (error, stdout, stderr) => {
			if (error) {
				reject({ error, stdout, stderr });
			}
			resolve({ stdout, stderr });
		});
	});
}

const channel = vscode.window.createOutputChannel("ZigHawk", { log: true });

export async function activate(context: vscode.ExtensionContext) {
	// Use the Zig task provider to provide tasks for `zig build`
	const taskProvider = new ZigTaskProvider();
	context.subscriptions.push(vscode.tasks.registerTaskProvider("zig-hawk", taskProvider));
}

// This method is called when your extension is deactivated
export function deactivate() {}

const regexBuildSteps = /^\s*(\w*)\s*(\(default\))?\s*(.*)$/gm;

interface BuildStep {
	name: string; 
	default: boolean;
	description: string;
}

async function getBuildSteps(cwd: string) {
	channel.info(`Getting build steps for: ${cwd}`);
	const steps = new Array<BuildStep>();
	const {stdout} = await exec("zig build --list-steps", { cwd });
	for (const match of stdout.matchAll(regexBuildSteps)) {
		const name = match[1].trim();
		if (name) {
			const $default = !!match[2];
			const description = match[3].trim();
			channel.info(`  Matched build step`, { name, description, default: $default });
			steps.push({ name, default: $default, description });
		}
	}
	return steps;
}

// async function getAllBuildSteps(): Promise<{ cwd: string; steps: BuildStep[]; }[]> {
// 	// Find all `build.zig` files in the workspace
// 	const files = await vscode.workspace.findFiles('**/build.zig');
// 	const all = new Array<{ cwd: string; steps: BuildStep[]; }>();
// 	for (const file of files) {
// 		const cwd = path.dirname(file.fsPath);
// 		const steps = await getBuildSteps(cwd);
// 		if (steps.length > 0) {
// 			all.push({cwd, steps});
// 		}
// 	}
// 	return all;
// }

interface ZigTaskDefinition extends vscode.TaskDefinition {
	task: string;
}

class ZigTaskProvider implements vscode.TaskProvider {
	async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {
		const tasks = new Array<vscode.Task>();
		const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
		for (const folder of workspaceFolders) {
			const cwd = folder.uri.fsPath;
			if (!cwd) { continue; }
			const steps = await getBuildSteps(cwd);
			for (const step of steps) {
				const args = step.default ? ['build'] : ['build', step.name];
				const execution = new vscode.ProcessExecution("zig", args, {cwd});
				const task = new vscode.Task({ type: "zig-hawk", task: step.name }, folder, step.name, "zig-hawk", execution);
				if (step.default) {
					task.group = vscode.TaskGroup.Build;
				}
				tasks.push(task);
			}
		}
		return tasks;
	}

	resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task> {
		return task;
	}
}