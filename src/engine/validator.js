class Validator {
    constructor(shell, fs) {
        this.shell = shell;
        this.fs = fs;
    }

    validate(exercise, lastCommand, lastResult) {
        const { validation } = exercise;
        if (!validation) return true;

        switch (validation.type) {
            case 'command_contains':
                return lastCommand.includes(validation.text);

            case 'command_output':
                return new RegExp(validation.pattern).test(lastResult.stdout);

            case 'command_output_contains':
                return lastResult.stdout.includes(validation.text);

            case 'alias_exists':
                return this.shell.aliases[validation.name] === validation.command;

            case 'file_exists':
                const node = this.fs._getNode(validation.path);
                if (!node) return false;
                if (validation.is_dir) return node.type === 'dir';
                return node.type === 'file';

            case 'file_content':
                const content = this.fs.readFile(validation.path);
                return content && content.trim() === validation.content.trim();

            case 'file_executable':
                const execNode = this.fs._getNode(validation.path);
                // In our simple sim, we check if chmod was called or if we want to simulate permissions
                // For now, let's assume chmod +x sets a flag or we check the permissions string
                return execNode && (execNode.permissions === '+x' || execNode.permissions === '755' || execNode.permissions === '777');

            case 'file_permissions':
                const permNode = this.fs._getNode(validation.path);
                return permNode && permNode.permissions === validation.mode;

            case 'file_not_exists':
                return !this.fs.exists(validation.path);

            case 'current_dir':
                return this.fs.cwd === validation.path;

            default:
                return false;
        }
    }
}
