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

interface ZigTaskDefinition extends vscode.TaskDefinition {
	type: 'zig-hawk';
	step: string;
	args?: string[]; 
	options?: Pick<vscode.ProcessExecutionOptions, "cwd">;
}

class ZigTaskProvider implements vscode.TaskProvider {
	async provideTasks(token: vscode.CancellationToken) {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) { return undefined; }

		const opened = vscode.window.activeTextEditor?.document?.uri;
		const folder = (opened && vscode.workspace.getWorkspaceFolder(opened)) || folders[0];

		const tasks = new Array<vscode.Task>();
		const steps = await getBuildSteps(folder.uri.fsPath);
		for (const step of steps) {
			const def: ZigTaskDefinition = {
				type: "zig-hawk",
				step: step.name,
			};
			const task = makeZigTask(def, folder);
			task.detail = step.description; 
			if (step.default) { task.group = vscode.TaskGroup.Build; }
			tasks.push(task);
		}
		return tasks;
	}

	resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task> {
		return makeZigTask(task.definition as ZigTaskDefinition, task.scope ?? vscode.TaskScope.Workspace);
	}
}

function makeZigTask(definition: ZigTaskDefinition, scope: vscode.TaskScope | vscode.WorkspaceFolder ) {
	const cwd = definition.options?.cwd ?? (isWorkspaceFolder(scope) ? scope.uri.fsPath : undefined);
	const args = ["build", definition.step]; 
	if (definition.args && definition.args.length > 0) {
		args.push('--', ...definition.args); 
	}
	const execution = new vscode.ProcessExecution("zig", args, { cwd });

	const task = new vscode.Task(definition, scope, definition.step, "zig-hawk", execution);
	task.problemMatchers = ["$zig-hawk"];
	return task;
}

function isWorkspaceFolder(scope: vscode.WorkspaceFolder | vscode.TaskScope): scope is vscode.WorkspaceFolder {
	return typeof scope !== 'number' && 'uri' in scope;
}