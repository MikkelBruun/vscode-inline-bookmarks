'use strict'
/** 
 * @author github.com/tintinweb
 * @license MIT
 * 
 * 
 * */
/** imports */
const vscode = require('vscode');
const fs = require("fs");

const settings = require('../settings')

class Commands {
    constructor(controller){
        this.controller = controller;
    }

    refresh() {
        Object.keys(this.controller.bookmarks).forEach(uri => {
            vscode.workspace.openTextDocument(vscode.Uri.parse(uri)).then(document => {
                console.error(document)
                this.controller.updateBookmarks(document)
            });
        }, this);
    }
}

class InlineBookmarksCtrl {

    constructor(context) {
        this.context = context;
        this.styles = this._reLoadDecorations();
        this.words = this._reLoadWords();

        this.commands = new Commands(this);

        this.bookmarks = {};  // {file: {bookmark}}
        this.loadFromWorkspace();
    }

    /** -- public -- */

    hasBookmarks(){
        return !!this.bookmarks;
    }

    async decorate(editor){
        if (!editor || !editor.document || editor.document.fileName.startsWith("extension-output-")) return;

        this._clearBookmarksOfFile(editor.document)

        for (var style in this.words) {
            if (!this.words.hasOwnProperty(style) || this.words[style].length == 0) {           
                continue;
            }
            this._decorateWords(editor, this.words[style], style);
        }

        this.saveToWorkspace(); //update workspace
    }

    async updateBookmarks(document){
        
        if (!document || document.fileName.startsWith("extension-output-")) return;

        for (var style in this.words) {
            if (!this.words.hasOwnProperty(style) || this.words[style].length == 0) {           
                continue;
            }
            this._updateBookmarksForWordAndStyle(document, this.words[style], style);
        }

        this.saveToWorkspace(); //update workspace
    }

    /** -- private -- */

    async _decorateWords(editor, words, style){
        const decoStyle = this.styles[style] || this.styles['default'];

        let locations = this._findWords(editor.document, words)

        editor.setDecorations(decoStyle, locations);  // set decorations

        this._addBookmark(editor.document, style, locations)
    }

    async _updateBookmarksForWordAndStyle(document, words, style){
        const decoStyle = this.styles[style] || this.styles['default'];

        let locations = this._findWords(document, words);

        this._addBookmark(document, style, locations);
    }

    _findWords(document, words){
        const text = document.getText();
        var locations = [];

        words.forEach(function(word){

            var regEx = new RegExp( word ,"g");
            let match;
            while (match = regEx.exec(text)) {
                
                var startPos = document.positionAt(match.index);
                var endPos = document.positionAt(match.index + match[0].trim().length);

                var fullLine = document.getWordRangeAtPosition(startPos, /(.+)$/);

                var decoration = { 
                    range: new vscode.Range(startPos, endPos), 
                    text: document.getText(new vscode.Range(startPos, fullLine.end))
                };

                locations.push(decoration);
            }
        });

        return locations;
    }

    _clearBookmarksOfFile(document) {
        let filename = document.uri
        if(!this.bookmarks.hasOwnProperty(filename)) return;
        delete this.bookmarks[filename];
    }

    _clearBookmarksOfFileAndStyle(document, style){
        let filename = document.uri
        if(!this.bookmarks.hasOwnProperty(filename)) return;
        delete this.bookmarks[filename][style];
    }

    _addBookmark(document, style, locations){
        let filename = document.uri
        if(!this.bookmarks.hasOwnProperty(filename)){
            this.bookmarks[filename] = {}
        }
        this.bookmarks[filename][style] = locations;
    }

    _reLoadWords(){
        return settings.extensionConfig().words;
    }

    _reLoadDecorations() {
        let styles = {}

        for (var decoId in settings.extensionConfig().styles) {


            if (!settings.extensionConfig().styles.hasOwnProperty(decoId)) {           
                continue;
            }

            let decoOptions = { ...settings.extensionConfig().styles[decoId]}

        
            //fix path
            decoOptions.gutterIconPath = this.context.asAbsolutePath(decoOptions.gutterIconPath);
        
            //overview
            if(decoOptions.overviewRulerColor){
                decoOptions.overviewRulerLane = vscode.OverviewRulerLane.Full;
            }
            
            //background color
            if (decoOptions.backgroundColor) {
                decoOptions.isWholeLine = true;
            }
        
            styles[decoId] = vscode.window.createTextEditorDecorationType(decoOptions);
        }

        return styles;
    }

    _isWorkspaceAvailable() {
        //single or multi root
        return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length >= 1;
    }

    saveToWorkspace(){
        if(!this._isWorkspaceAvailable()) return; //cannot save
        this.context.workspaceState.update("bookmarks.object", JSON.stringify(this.bookmarks));
    }

    loadFromWorkspace(){
        if(!this._isWorkspaceAvailable()) return; //cannot load
        this.bookmarks = JSON.parse(this.context.workspaceState.get("bookmarks.object", "{}"));  //@audit-ok workspace is trusted :)

        //remove all non existing files
        Object.keys(this.bookmarks).forEach(filepath => {
            if (!fs.existsSync(vscode.Uri.parse(filepath).fsPath)) {
                delete this.bookmarks[filepath];
                return;
            }
            
            Object.keys(this.bookmarks[filepath]).forEach(cat => {  //@audit - validate data before objectifying it
                //for each category
                this.bookmarks[filepath][cat] = this.bookmarks[filepath][cat].map(decoObject => {
                    //fix - rebuild range object (it is expected by other functions)
                    decoObject.range = new vscode.Range(decoObject.range[0].line, decoObject.range[0].character, decoObject.range[1].line, decoObject.range[1].character);
                    return decoObject;
                });
            });
        });
    }
}

const NodeType = {
    FILE : 1,
    CATEGORY : 2,
    LOCATION : 3
}


class InlineBookmarksDataModel {

    /** treedata model */

    constructor(controller){
        this.controller = controller;
    }

    getRoot(){  /** returns element */
        return Object.keys(this.controller.bookmarks).sort().map(v => {
            return { 
                resource: vscode.Uri.parse(v), 
                tooltip: v,
                name:v, 
                type: NodeType.FILE, 
                parent: null,
                iconPath: vscode.ThemeIcon.File,
                location: null }
        })
    }

    getChildren(element){
        switch(element.type){
            case NodeType.FILE:
                return Object.keys(this.controller.bookmarks[element.name]).map(cat => {
                    //all categories
                    return this.controller.bookmarks[element.name][cat].map(v => { 
                        let location = new vscode.Location(element.resource, v.range);
                        return { 
                            resource: element.resource,
                            location: location,
                            label: v.text.trim(),
                            name: v.text.trim(), 
                            type: NodeType.LOCATION, 
                            category: cat,
                            parent:element,
                            iconPath: vscode.Uri.parse(this.controller.context.asAbsolutePath(`images/bookmark-${cat}.svg`))
                        }
                    });
                }).flat(1);
            case NodeType.CATEGORY:
            case NodeType.LOCATION:
            break;
        }
        
    }
}

class InlineBookmarkTreeDataProvider {

    constructor(inlineBookmarksController){
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;

        this.controller = inlineBookmarksController;
        this.model = new InlineBookmarksDataModel(inlineBookmarksController);
    }

    /** events */

    /** methods */

    getChildren(element){
        return element ? this.model.getChildren(element): this.model.getRoot();
    }

    getParent(element){
        const parent = element.resource.with({ path: dirname(element.resource.path) });
        return parent.path !== '//' ? { resource: parent, isFilename: true } : null;
    }

    getTreeItem(element){
        return {
            resourceUri: element.resource,
            label: element.label,
            iconPath: element.iconPath,
            collapsibleState: element.type==NodeType.LOCATION ? 0 : vscode.TreeItemCollapsibleState.Collapsed,
            command: element.type == NodeType.LOCATION && element.location ? {
                command: 'inlineBookmarks.jumpToRange',
                arguments: [element.location.uri, element.location.range],  //@audit-issue - filed: only works with range objects
                title: 'JumpTo'
            } : 0
        };
    }

    /** other methods */

    refresh(){
        this._onDidChangeTreeData.fire(); //@audit-info - notify treeview 
    }
}


module.exports = {
    InlineBookmarksCtrl:InlineBookmarksCtrl,
    InlineBookmarkTreeDataProvider:InlineBookmarkTreeDataProvider
}
