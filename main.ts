import {
	App,
	Editor,
	FuzzySuggestModal,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface MarkdownBloggerSettings {
	projectFolder: string;
	showHiddenFolders: boolean;
	postsFolder: string;
	imagesFolder: string;
}

const DEFAULT_SETTINGS: MarkdownBloggerSettings = {
	projectFolder: "",
	showHiddenFolders: false,
	postsFolder: "",
	imagesFolder: "",
};

enum Action {
	Push,
	Pull,
}

export default class MarkdownBlogger extends Plugin {
	settings: MarkdownBloggerSettings;

	private async processImages(
		text: string,
		sourcePath: string,
		destinationPath: string
	): Promise<string> {
		// Process frontmatter
		const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
		const frontmatterMatch = text.match(frontmatterRegex);

		if (frontmatterMatch) {
			const frontmatter = frontmatterMatch[1];
			let processedFrontmatter = frontmatter;

			// Process frontmatter image
			const imageRegex = /image:\s*(\.\/.*?\.(?:png|jpg|jpeg|gif))/i;
			processedFrontmatter = processedFrontmatter.replace(
				imageRegex,
				(match, imagePath) => {
					try {
						// Get the source markdown file's directory and the vault root path
						const vaultRoot = (this.app.vault as any).adapter
							.basePath;
						const currentNoteDir = path.dirname(sourcePath);

						// Extract image name from the path
						const imageFileName = path.basename(imagePath);

						// Look for the image in the attachments folder
						const sourceImagePath = path.join(
							vaultRoot,
							currentNoteDir,
							"attachments",
							imageFileName
						);

						// Create a post-specific attachments/cover-image folder for the frontmatter image
						const postFolder = path.dirname(destinationPath);
						const attachmentsFolder = path.join(
							postFolder,
							"attachments"
						);
						const coverImageFolder = path.join(
							attachmentsFolder,
							"cover-image"
						);

						// Create the destination path for the image
						const destImagePath = path.resolve(
							coverImageFolder,
							imageFileName
						);

						// Copy the image file if it exists
						if (fs.existsSync(sourceImagePath)) {
							if (!fs.existsSync(coverImageFolder)) {
								fs.mkdirSync(coverImageFolder, {
									recursive: true,
								});
							}
							fs.copyFileSync(sourceImagePath, destImagePath);
							return `image: ./attachments/cover-image/${imageFileName}`;
						}
					} catch (error) {
						console.error(
							"Error processing frontmatter image:",
							error
						);
					}
					return match;
				}
			);

			// Process tags format
			const tagsRegex = /tags:\n((?:[ ]{2}- .*\n)*)/;
			processedFrontmatter = processedFrontmatter.replace(
				tagsRegex,
				(match, tagsList: string) => {
					const tags = tagsList
						.split("\n")
						.filter((line: string) => line.trim().startsWith("- "))
						.map((line: string) => {
							const tag = line.trim().substring(2).trim();
							// Remove # prefix if it exists and wrap in quotes
							return `"${
								tag.startsWith("#") ? tag.substring(1) : tag
							}"`;
						})
						.filter((tag: string) => tag);

					return `tags: [${tags.join(", ")}]\n`; // Add newline after the array
				}
			);

			// Replace the original frontmatter with processed one
			text = text.replace(frontmatterMatch[1], processedFrontmatter);
		}

		// Process inline images
		const obsidianImageRegex = /!\[\[(.*?)\]\]/g;
		const processedText = text.replace(
			obsidianImageRegex,
			(match, imagePath) => {
				try {
					// Remove any extra spaces from the image path
					imagePath = imagePath.trim();

					// Get the source markdown file's directory and the vault root path
					const vaultRoot = (this.app.vault as any).adapter.basePath;
					const currentNoteDir = path.dirname(sourcePath);

					// Look for the image in the attachments folder relative to the markdown file
					const sourceImagePath = path.join(
						vaultRoot,
						currentNoteDir,
						"attachments",
						path.basename(imagePath)
					);

					// Create a post-specific attachments folder for images
					const postFolder = path.dirname(destinationPath);
					const attachmentsFolder = path.join(
						postFolder,
						"attachments"
					);

					// Create the destination path for the image in the attachments folder
					const imageFileName = path.basename(imagePath);
					const destImagePath = path.resolve(
						attachmentsFolder,
						imageFileName
					);

					// Copy the image file
					if (fs.existsSync(sourceImagePath)) {
						// Create the attachments directory if it doesn't exist
						if (!fs.existsSync(attachmentsFolder)) {
							fs.mkdirSync(attachmentsFolder, {
								recursive: true,
							});
						}

						// Copy the image file
						fs.copyFileSync(sourceImagePath, destImagePath);

						// Return the image reference using relative path to attachments folder
						return `![${imageFileName}](./attachments/${imageFileName})`;
					} else {
						console.log("Image not found at:", sourceImagePath);
						new Notice(`Image not found: ${sourceImagePath}`);
						return match; // Keep original syntax if image not found
					}
				} catch (error) {
					console.error("Error processing image:", error);
					return match;
				}
			}
		);

		return processedText;
	}

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "validate-path",
			name: "Validate path",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const { projectFolder } = this.settings;
				if (!fs.existsSync(projectFolder)) {
					new ErrorModal(this.app).open();
					return;
				}
				new Notice(`Valid path: ${this.settings.projectFolder}`);
			},
		});

		this.addCommand({
			id: "push-md",
			name: "Push markdown",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const { projectFolder } = this.settings;
				if (!fs.existsSync(projectFolder)) {
					new ErrorModal(this.app).open();
					return;
				}

				// Get the current note's content and path
				const text = editor.getDoc().getValue();
				const currentFilePath = view.file.path; // Get the relative path within the vault

				// Create post-specific folder with original filename
				const postName = path.basename(view.file.name, ".md");
				const postFolder = path.join(
					this.settings.projectFolder,
					this.settings.postsFolder,
					postName
				);

				// Ensure the post folder exists
				if (!fs.existsSync(postFolder)) {
					fs.mkdirSync(postFolder, { recursive: true });
				}

				// Keep the original markdown filename
				const projectBlogPath = path.join(postFolder, view.file.name);

				// Process images and get modified content
				const processedContent = await this.processImages(
					text,
					currentFilePath, // Pass the relative path within the vault
					projectBlogPath
				);

				try {
					fs.writeFileSync(projectBlogPath, processedContent, {
						encoding: "utf8",
					});
					new Notice(
						`File and images pushed successfully to ${projectBlogPath}`
					);
				} catch (err) {
					new Notice(err.message);
				}
			},
		});

		this.addCommand({
			id: "pull-md",
			name: "Pull markdown",
			editorCheckCallback: (
				checking: boolean,
				editor: Editor,
				view: MarkdownView
			) => {
				const projectBlogPath = path.resolve(
					this.settings.projectFolder,
					view.file.name
				);

				if (fs.existsSync(projectBlogPath)) {
					if (!checking) {
						try {
							const file = fs.readFileSync(
								projectBlogPath,
								"utf8"
							);
							editor.getDoc().setValue(file);
							new Notice(
								`Your file has been pulled! From ${projectBlogPath}`
							);
						} catch (err) {
							new Notice(err.message);
						}
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "push-custom-path-md",
			name: "Push to custom path",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new PathModal(this.app, this.settings, Action.Push).open();
			},
		});

		this.addCommand({
			id: "pull-custom-path",
			name: "Pull from custom path",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new PathModal(this.app, this.settings, Action.Pull).open();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new MarkdownBloggerSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ErrorModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(
			"The project folder does not exist. Please create the path or update the current path in plugin settings."
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class PathModal extends FuzzySuggestModal<string> {
	currPath = os.homedir();
	settings: MarkdownBloggerSettings;
	action: Action;

	constructor(app: App, settings: MarkdownBloggerSettings, action: Action) {
		super(app);
		this.settings = settings;
		this.action = action;
	}

	getItems(): string[] {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		const paths = fs.readdirSync(this.currPath).filter((p) => {
			const fullPath = path.resolve(this.currPath, p);
			let stats;
			try {
				stats = fs.statSync(fullPath, { throwIfNoEntry: false });
			} catch (e) {
				return false;
			}
			if (stats === undefined) return false;
			return (
				(stats.isDirectory() ||
					path.basename(fullPath) === view?.file.name) &&
				(p[0] !== "." || this.settings.showHiddenFolders)
			);
		});

		paths.push("..");
		paths.push("Select");

		return paths;
	}

	getItemText(dir: string): string {
		return dir;
	}

	onChooseItem(dir: string, evt: MouseEvent | KeyboardEvent) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (dir === "Select") {
			if (view) {
				if (!fs.existsSync(path.resolve(this.currPath))) {
					new ErrorModal(this.app).open();
					return;
				}

				const text = view.editor.getDoc().getValue();
				const filePath = path.resolve(this.currPath, view.file.name);
				if (this.action === Action.Push) {
					try {
						fs.writeFileSync(`${filePath}`, text, {
							encoding: "utf8",
						});
						new Notice(`Your file has been pushed! At ${filePath}`);
					} catch (err) {
						new Notice(err.message);
					}
				} else if (this.action === Action.Pull) {
					try {
						const file = fs.readFileSync(filePath, "utf8");
						view.editor.getDoc().setValue(file);
						new Notice(
							`Your file has been pulled! From ${filePath}`
						);
					} catch (err) {
						new Notice(err.message);
					}
				}
			}
			return;
		} else if (view && dir === view.file.name) {
			const filePath = path.resolve(this.currPath, view.file.name);
			if (this.action === Action.Push) {
				const text = view.editor.getDoc().getValue();
				try {
					fs.writeFileSync(`${filePath}`, text, { encoding: "utf8" });
					new Notice(`Your file has been pushed! At ${filePath}`);
				} catch (err) {
					new Notice(err.message);
				}
			} else if (this.action === Action.Pull) {
				try {
					const file = fs.readFileSync(filePath, "utf8");
					view.editor.getDoc().setValue(file);
					new Notice(`Your file has been pulled! From ${filePath}`);
				} catch (err) {
					new Notice(err.message);
				}
			}
			return;
		} else {
			this.currPath = path.normalize(path.join(this.currPath, dir));
		}
		this.open();
	}
}

class MarkdownBloggerSettingTab extends PluginSettingTab {
	plugin: MarkdownBlogger;

	constructor(app: App, plugin: MarkdownBlogger) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Settings for Obsidian Markdown Blogger.",
		});

		new Setting(containerEl)
			.setName("Local project folder path")
			.setDesc(
				"The local project folder for your blog, portfolio, or static site. Must be an absolute path."
			)
			.addText((text) =>
				text
					.setPlaceholder(
						"/Users/johnsample/projects/astro-blog/collections/"
					)
					.setValue(this.plugin.settings.projectFolder)
					.onChange(async (value) => {
						this.plugin.settings.projectFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show hidden folders")
			.setDesc("Show hidden folders when pushing to a custom path")
			.addToggle((cb) =>
				cb
					.setValue(this.plugin.settings.showHiddenFolders)
					.onChange(async (value) => {
						this.plugin.settings.showHiddenFolders = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Posts folder path")
			.setDesc("The folder where posts will be stored")
			.addText((text) =>
				text
					.setPlaceholder("src/content/posts")
					.setValue(this.plugin.settings.postsFolder)
					.onChange(async (value) => {
						this.plugin.settings.postsFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Images folder path")
			.setDesc(
				"The folder where images will be copied (relative to project folder)"
			)
			.addText((text) =>
				text
					.setPlaceholder("src/content/posts")
					.setValue(this.plugin.settings.imagesFolder)
					.onChange(async (value) => {
						this.plugin.settings.imagesFolder = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
