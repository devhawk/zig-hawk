import * as vscode from 'vscode';
import * as cp from 'node:child_process';

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
export function deactivate() { }

const regexBuildSteps = /^\s*(\w*)\s*(\(default\))?\s*(.*)$/gm;

interface BuildStep {
	name: string;
	default: boolean;
	description: string;
}

async function getBuildSteps(cwd: string) {
	channel.info(`Getting build steps for: ${cwd}`);
	const steps = new Array<BuildStep>();
	const { stdout } = await exec("zig build --list-steps", { cwd });
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

interface ZigTaskDefinition {
	type: 'zig-hawk';
	step: string;
	options?: {
		cwd?: string;
	}
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
				const execution = new vscode.ProcessExecution("zig", ['build', step.name], { cwd });
				const def: ZigTaskDefinition = {
					type: "zig-hawk",
					step: step.name,
					options: { cwd }
				};
				const task = new vscode.Task(def, folder, step.name, "zig-hawk", execution);
				task.detail = step.description;
				if (step.default) {
					task.group = vscode.TaskGroup.Build;
				}
				tasks.push(task);
			}
		}
		return tasks;
	}

	resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task> {
		const { step, options } = task.definition as ZigTaskDefinition;
		task.execution = new vscode.ProcessExecution("zig", ['build', step], { cwd: options?.cwd });
		return task;
	}
}