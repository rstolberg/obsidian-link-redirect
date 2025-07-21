import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, FuzzyMatch, FuzzySuggestModal } from 'obsidian';

interface LinkRedirectSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: LinkRedirectSettings = {
	mySetting: 'default'
}

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(file);
	}
}

export default class LinkRedirectPlugin extends Plugin {
	settings: LinkRedirectSettings;

	async onload() {
		await this.loadSettings();

		// Main command for redirecting links
		this.addCommand({
			id: 'redirect-incoming-links',
			name: 'Redirect incoming links to another note',
			callback: () => {
				this.redirectIncomingLinks();
			}
		});

		// Ribbon icon
		const ribbonIconEl = this.addRibbonIcon('git-graph', 'Link Redirect', (evt: MouseEvent) => {
			this.redirectIncomingLinks();
		});
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// Settings tab
		this.addSettingTab(new LinkRedirectSettingTab(this.app, this));
	}

	async redirectIncomingLinks() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('No active note found');
			return;
		}

		const currentFile = activeView.file;
		if (!currentFile) {
			new Notice('No file is currently open');
			return;
		}

		// Find all files that link to the current note using resolvedLinks
		const backlinks = this.findBacklinks(currentFile);
		
		if (backlinks.length === 0) {
			new Notice('No incoming links found for this note');
			return;
		}

		// Show modal to select target note
		new NoteSuggestModal(this.app, async (targetFile: TFile) => {
			if (targetFile.path === currentFile.path) {
				new Notice('Cannot redirect to the same note');
				return;
			}

			await this.performRedirect(currentFile, targetFile, backlinks);
		}).open();
	}

	findBacklinks(targetFile: TFile): TFile[] {
		const backlinks: TFile[] = [];
		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		const targetPath = targetFile.path;

		// Iterate through all files and their resolved links
		for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
			// Check if this file links to our target file
			if (links[targetPath] !== undefined) {
				const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath) as TFile;
				if (sourceFile) {
					backlinks.push(sourceFile);
				}
			}
		}

		return backlinks;
	}

	async performRedirect(sourceFile: TFile, targetFile: TFile, backlinks: TFile[]) {
		let updatedCount = 0;
		const sourceBasename = sourceFile.basename;
		const targetBasename = targetFile.basename;

		// Iterate through all files that have backlinks to the source file
		for (const file of backlinks) {
			try {
				let content = await this.app.vault.read(file);
				let modified = false;

				// Replace different types of links
				// 1. Wikilinks [[Note Name]]
				const wikilinkRegex = new RegExp(`\\[\\[${this.escapeRegex(sourceBasename)}\\]\\]`, 'g');
				if (wikilinkRegex.test(content)) {
					content = content.replace(wikilinkRegex, `[[${targetBasename}]]`);
					modified = true;
				}

				// 2. Wikilinks with display text [[Note Name|Display Text]]
				const wikilinkWithTextRegex = new RegExp(`\\[\\[${this.escapeRegex(sourceBasename)}\\|([^\\]]+)\\]\\]`, 'g');
				if (wikilinkWithTextRegex.test(content)) {
					content = content.replace(wikilinkWithTextRegex, `[[${targetBasename}|$1]]`);
					modified = true;
				}

				// 3. Markdown links [Display Text](Note Name.md)
				const markdownLinkRegex = new RegExp(`\\[([^\\]]+)\\]\\(${this.escapeRegex(sourceFile.name)}\\)`, 'g');
				if (markdownLinkRegex.test(content)) {
					content = content.replace(markdownLinkRegex, `[$1](${targetFile.name})`);
					modified = true;
				}

				// 4. Simple markdown links [Display Text](Note Name)
				const simpleMarkdownLinkRegex = new RegExp(`\\[([^\\]]+)\\]\\(${this.escapeRegex(sourceBasename)}\\)`, 'g');
				if (simpleMarkdownLinkRegex.test(content)) {
					content = content.replace(simpleMarkdownLinkRegex, `[$1](${targetBasename})`);
					modified = true;
				}

				if (modified) {
					await this.app.vault.modify(file, content);
					updatedCount++;
				}
			} catch (error) {
				console.error(`Error updating file ${file.path}:`, error);
			}
		}

		if (updatedCount > 0) {
			new Notice(`Successfully redirected links in ${updatedCount} file(s) from "${sourceBasename}" to "${targetBasename}"`);
		} else {
			new Notice('No links were found to redirect');
		}
	}

	escapeRegex(string: string): string {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class LinkRedirectSettingTab extends PluginSettingTab {
	plugin: LinkRedirectPlugin;

	constructor(app: App, plugin: LinkRedirectPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'Link Redirect Settings'});

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('Plugin configuration')
			.addText(text => text
				.setPlaceholder('Enter configuration')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
