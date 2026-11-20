// Fixed: the Yjs undo manager owns ⌘Z.
export function NoteEditor() {
  return (
    <LexicalComposer initialConfig={config}>
      <CollaborationPluginV2 id={id} providerFactory={factory} />
    </LexicalComposer>
  );
}
