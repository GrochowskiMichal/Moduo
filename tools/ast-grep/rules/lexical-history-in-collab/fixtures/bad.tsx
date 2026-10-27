// Pre-fix shape: local history next to the collab binding.
export function NoteEditor() {
  const history = (
    // @flag
    <HistoryPlugin />
  );
  return (
    <LexicalComposer initialConfig={config}>
      <CollaborationPluginV2 id={id} providerFactory={factory} />
      {history}
    </LexicalComposer>
  );
}
