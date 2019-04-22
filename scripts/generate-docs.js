const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const i18n = require('i18n');

i18n.configure({
	locales: ['en'],
	defaultLocale: 'en',
	directory: __dirname + '/../locale',
	objectNotation: true
});

const t = (key, replacements) =>
	i18n.__({ locale: 'en', phrase: key }, replacements);

function generateGroup(path, group) {
	let out = '';
	if (path.length > 0) {
		const prefix = '#'.repeat(path.length + 2);
		out += `${prefix} ${t(`settings.groups.${path.join('.')}.title`)}\n\n`;
		if (group.__settings) {
			out += `| Setting | Description |\n|---|---|\n`;
			out += group.__settings
				.map(
					key =>
						`| [${t(`settings.${key}.title`)}](#${key.toLowerCase()}) | ${t(
							`settings.${key}.description`
						)}`
				)
				.join('\n');
		}
		out += `\n\n`;
	}
	Object.keys(group).forEach(subGroup => {
		if (subGroup === '__settings') {
			return;
		}
		out += generateGroup(path.concat(subGroup), group[subGroup]);
	});
	return out;
}

let child = spawn(
	/^win/.test(process.platform) ? 'npm.cmd' : 'npm',
	['run', 'build'],
	{
		stdio: 'inherit'
	}
);

child.on('error', error => console.log(error));

child.on('close', () => {
	// Import after compile
	const { settingsInfo } = require('../bin/settings.js');
	const { CommandGroup } = require('../bin/types');

	// Generate config docs
	const settings = {};
	Object.keys(settingsInfo).forEach(key => {
		const info = settingsInfo[key];
		let text = `---\n## ${t(`settings.${key}.title`)}\n\n`;
		text += `${t(`settings.${key}.description`)}\n\n`;
		text += `Type: \`${info.type}\`\n\n`;
		text += `Default: \`${info.defaultValue}\`\n\n`;
		text += `Reset to default:\n\`!config ${key} default\`\n\n`;
		if (info.type === 'Boolean') {
			text += `Enable:\n\n`;
			text += `\`!config ${key} true\`\n\n`;
			text += `Disable:\n\n`;
			text += `\`!config ${key} false\`\n\n`;
		} else {
			if (info.possibleValues) {
				text += `Possible values: ${info.possibleValues
					.map(v => `\`${v}\``)
					.join(', ')}\n\n`;
				text += `Example:\n\n`;
				text += `\`!config ${key} ${info.possibleValues[0]}\`\n\n`;
			}
			if (info.exampleValues) {
				text += `Examples:\n\n`;
				info.exampleValues.forEach(ex => {
					text += `\`!config ${key} ${ex}\`\n\n`;
				});
			}
		}
		if (info.premiumInfo) {
			text += `{% hint style="info" %} ${info.premiumInfo} {% endhint %}`;
		}
		info.markdown = text;

		let curr = settings;
		info.grouping.forEach(grp => {
			let next = curr[grp];
			if (!next) {
				next = {};
				curr[grp] = next;
			}
			curr = next;
		});

		if (!curr.__settings) {
			curr.__settings = [];
		}
		curr.__settings.push(key);
	});

	let outSettings = '# Configs\n\n';
	outSettings +=
		'There are many config options that can be set. ' +
		`You don't have to set all of them. If you just added the bot, just run ` +
		'`!setup`, which will guide you through the most important ones.\n\n';

	outSettings += '## Overview\n\n';
	outSettings += generateGroup([], settings);

	outSettings += Object.keys(settingsInfo)
		.map(key => `<a name=${key}></a>\n\n` + settingsInfo[key].markdown)
		.join('\n\n');

	fs.writeFileSync('./docs/getting-started/settings.md', outSettings);

	// Generate command docs
	const cmds = [];
	const cmdDir = path.resolve(__dirname, '../bin/commands/');
	const fakeClient = {
		msg: {
			createEmbed: () => {},
			sendReply: () => {},
			sendEmbed: () => {},
			showPaginated: () => {}
		},
		cmds: {
			commands: cmds
		}
	};
	const loadRecursive = dir =>
		fs.readdirSync(dir).forEach(fileName => {
			const file = dir + '/' + fileName;

			if (fs.statSync(file).isDirectory()) {
				loadRecursive(file);
				return;
			}

			if (!fileName.endsWith('.js')) {
				return;
			}

			const clazz = require(file);
			if (clazz.default) {
				const constr = clazz.default;
				const inst = new constr(fakeClient);
				cmds.push(inst);
			}
		});
	loadRecursive(cmdDir);
	console.log(`Loaded \x1b[32m${cmds.length}\x1b[0m commands!`);

	let outCmds = '# Commands\n\n';
	outCmds +=
		'To get a list of available commands, do !help on your server.\n\n';

	outCmds += '## Overview\n\n';
	Object.keys(CommandGroup).forEach(group => {
		const groupCmds = cmds
			.filter(c => c.group === group)
			.sort((a, b) => a.name.localeCompare(b.name));
		if (groupCmds.length === 0) {
			return;
		}

		outCmds += `### ${group}\n\n| Command | Description | Usage |\n|---|---|---|\n`;
		outCmds += groupCmds
			.map(
				cmd =>
					`| [${cmd.name}](#${cmd.name}) ` +
					`| ${t(`cmd.${cmd.name}.self.description`)} | ` +
					`${cmd.usage
						.replace('{prefix}', '!')
						.replace(/</g, '\\<')
						.replace(/>/g, '\\>')
						.replace(/\|/g, '\\|')} |`
			)
			.join('\n');
		outCmds += '\n\n';
	});

	cmds
		.sort((a, b) => a.name.localeCompare(b.name))
		.forEach(cmd => {
			const usage = cmd.usage.replace('{prefix}', '!');
			const info = cmd.getInfo2({ t });

			let infoText = '### Arguments\n\n';
			infoText += `| Argument | Type | Required | Description |\n|---|---|---|---|\n`;
			infoText += info.args
				.map(
					(arg, i) =>
						`| ${arg.name} | ${arg.type} | ${arg.required ? 'Yes' : ' '} ` +
						`| ${arg.description}`
				)
				.join('\n');
			infoText += '\n\n';
			infoText += '### Flags\n\n';
			infoText += `| Flag | Short | Description |\n|---|---|---|\n`;
			infoText += info.flags
				.map(
					flag =>
						`| --${flag.name} | ${flag.short ? '-' + flag.short : ' '} ` +
						`| ${flag.description} |`
				)
				.join('\n');
			infoText += '\n\n';
			infoText += '### Examples\n\n';
			infoText += generateExamples(cmd, info).join('  \n') + '\n\n';

			outCmds += `<a name='${cmd.name}'></a>\n\n---\n\n## !${cmd.name}\n\n`;
			outCmds += `${t(`cmd.${cmd.name}.self.description`)}\n\n`;
			outCmds +=
				'### Usage\n\n```text\n' + usage + '\n```' + `\n\n${infoText}\n\n`;
		});

	fs.writeFileSync('./docs/getting-started/commands.md', outCmds);
});

function generateExamples(cmd, info) {
	const examples = [];
	let pre = '```text\n' + `!${cmd.name} `;
	for (let i = 0; i < info.args.length; i++) {
		const arg = info.args[i];
		if (!arg.required && (i === 0 || info.args[i - 1].examples.length === 0)) {
			examples.push(pre + '\n```');
		}
		const exs = arg.examples;
		exs.forEach(ex => examples.push(pre + ex + '\n```'));
		pre += `${exs.length > 0 ? exs[0] : arg.name} `;
	}
	if (
		info.args.length === 0 ||
		info.args[info.args.length - 1].examples.length === 0
	) {
		examples.push(pre + '\n```');
	}
	if (examples.length > 0) {
		const ex = examples[0];
		for (let i = 0; i < info.flags.length; i++) {
			const flag = info.flags[i];
			examples.push(
				ex.replace(
					cmd.name + ' ',
					`${cmd.name} --${flag.name}=${flag.examples[0]} `
				)
			);
			if (flag.short) {
				examples.push(
					ex.replace(
						cmd.name + ' ',
						`${cmd.name} -${flag.short} ${flag.examples[0]} `
					)
				);
			}
		}
	}
	return examples;
}
