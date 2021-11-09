/* TODO LIST
- Display errors when the api returns an error
- Clean up this code
*/

const vscode = require('vscode');
const axios = require('axios');
const fs = require('fs');
const {
	URLSearchParams
} = require('url');

const website = "https://deepgenx.com/codegenx"

// Accessing settings from vscode:
const currentDocument = vscode.window.activeTextEditor.document;
const configuration = vscode.workspace.getConfiguration('', currentDocument.uri);
const temp = Number(configuration.get('Codegenx.Temperature', {}));
const token = String(configuration.get('Codegenx.Token', {}));
const token_max_length_str = String(configuration.get('Codegenx.MaxLength', {}));
const enable_selection = Boolean(configuration.get('Codegenx.EnableSelection', {}));

// Converting token_max_length from string to length (128 (fast) -> 128):
const token_max_length = parseInt(token_max_length_str);

// The comment proxy whcih replaces the hashtag (#)
const comment_proxy = "cgx_hashtag_comment"

async function activate(context) {
	let selectedEditor; //The editor to insert the completion into
	let selected_text;

	//A command to open the Codegenx window
	context.subscriptions.push(vscode.commands.registerCommand('codegenx.open_CodeGenX', async () => {
		if (token == "") {
			vscode.window.showInformationMessage(`It looks like you do not have an API token. You can go to ${website} for instructions on how to get one.`);
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('Please open an editor to use CodeGenX.');
			return;
		}

		const document = editor.document;
		let selection;
		if(enable_selection && !editor.selection.isEmpty) {
			selection = editor.selection;
			console.log(document.getText(selection))
			selected_text = true;
		}

		else if (editor.selection.isEmpty || !enable_selection) { //If nothing is highlited, get the word at the cursor;
  			const cursorPosition = editor.selection.active;
			selection = new vscode.Selection(0,0,cursorPosition.line, cursorPosition.character);
			console.log(document.getText(selection))
			selected_text = false;
		}

		selectedEditor = editor; //Save to be used when the completion is inserted
		selectedRange = selection;

		var language = {
			"python": "py",
			"javascript": "js"
		}[document.languageId]; // TODO: Figure out a way to actually get the extension and not just the language name

		console.log("selected_text:",selected_text)
		var word = document.getText(selection); //The word in the selection
		word = word.replaceAll("#", comment_proxy);
		await open_CodeGenX(word.trim(), language);

	}));

	const myScheme = 'codegenx';
	const textDocumentProvider = new class { //Provides a text document for the window
		async provideTextDocumentContent(uri) {
			const params = new URLSearchParams(uri.query);
			if (params.get('loading') === 'true') {
				return `/* CodeGenX is generating the output */\n`;
			}

			var word = params.get('word');

			try {
				word = word.replaceAll(comment_proxy, "#");
				const payload = { 'input': word, 'max_length': token_max_length, 'temperature': temp, 'token': token};

				const result = await axios.post(`http://api.deepgenx.com:5700/generate`, payload);

				if (result.data.success) {

					//return getGPTText(Array(result.data.message)) + "\n" + getSOText(word);
					return getGPTText(Array(result.data.message));
				} else {
					// vscode.window.showErrorMessage(result.data.error.message);
					return result.data.error.message;
				}
			} catch (err) {
				console.log('Error sending request', err);
				return 'There was an error sending the request\n' + err;
			}
		}
	}();
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(myScheme, textDocumentProvider));

	//Open the CodeGenX window to display the functions
	const open_CodeGenX = async (word, language) => {
		//A uri to send to the document
		let loadingUri = vscode.Uri.parse(`${myScheme}:CodeGenX?word=${word}&lang=${language}&loading=true`, true);
		await showUri(loadingUri); //Open a loading window
		let uri = vscode.Uri.parse(`${myScheme}:CodeGenX?word=${word}&lang=${language}&loading=false`, true);
		//TODO If the uri has already been loaded, the codelense breaks
		await showUri(uri); //Show the actual content, once got from the server
	}

	const showUri = async (uri) => {
		const doc = await vscode.workspace.openTextDocument(uri); //Calls back into the provider
		await vscode.window.showTextDocument(doc, {
			viewColumn: vscode.ViewColumn.Beside,
			preview: true, //Don't replace the current window
			preserveFocus: true,
		});
		vscode.languages.setTextDocumentLanguage(doc, 'python'); //Enables syntax highlighting
	}

	const getGPTText = (text) => {
		codelensProvider.clearPositions();
		let content = `/* CodeGenX is suggesting the following */\n`;
		let splitted_text = text[0];
		for (let i = 0; i < splitted_text.length; i++) {
			const lineNum = content.split('\n').length; //The line to insert the codelens on
			if (i===0){
			codelensProvider.addPosition(lineNum, splitted_text[i]);} //Add a codelens on that line
			if (i!=0){
				codelensProvider.addPosition(lineNum-1, splitted_text[i]);}
			content += splitted_text[i]; //Display the entire function in the CodeGenX window
			if (i < splitted_text.length - 1) content += '\n\n'; 
		}
		return content;
	}

	const getSOText = (text) => {
		//let content = `\n\n\n\n/* Stack Overflow Answers */\n\nWORK IN PROGRESS`;

		// Do stuff

		//return content;
	}

	//When the user clicks on a codelens for a function
	context.subscriptions.push(vscode.commands.registerCommand('CodeGenX.chooseOption', fn => {
		if (!selectedEditor) return;
		try {
			selectedEditor.edit(editBuilder => {
				var s = selectedEditor.selection

				editBuilder.replace(s, fn) //Insert the function into the text
			}).then(success => {
				var postion = selectedEditor.selection.end; 
				selectedEditor.selection = new vscode.Selection(postion, postion);
			});
		} catch (e) {
			//The editor isn't open
		}
	}));

	const codelensProvider = new class { //Keeps track of and provides codelenses
		constructor() {
			this.codelenses = [];
		}
		addPosition(lineNum, fn) {
			const range = new vscode.Range(lineNum, 0, lineNum, 0); //Display it on that line
			this.codelenses.push(new vscode.CodeLens(range, {
				title: 'Use code',
				command: 'CodeGenX.chooseOption',
				arguments: [
					fn
				],
				tooltip: 'Insert this snippet into your code'
			}));
		}
		clearPositions() {
			this.codelenses = [];
		}

		provideCodeLenses(document) {
			return this.codelenses;
		}

		//TODO Use resolveCodeLens() instead of making the command in addPosition?
	}();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider({
		scheme: myScheme //Only adds codelens to CodeGenX windows
	}, codelensProvider));
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}