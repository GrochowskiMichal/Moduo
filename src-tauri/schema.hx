N::Note {
  workspace_id: String,
  title: String,
  kind: String,
  tags: String,
  content_preview: String,
  created_at: String,
  updated_at: String
}

N::Task {
  workspace_id: String,
  project_id: String,
  title: String,
  description: String,
  state: String,
  priority: U32,
  tags: String,
  created_at: String,
  updated_at: String
}

N::Email {
  workspace_id: String,
  account_id: String,
  sender: String,
  subject: String,
  body_preview: String,
  folder: String,
  date: String
}

N::Project {
  workspace_id: String,
  name: String,
  description: String
}

V::NoteEmbedding { title: String, content_hash: String }
V::TaskEmbedding { title: String, content_hash: String }
V::EmailEmbedding { subject: String, content_hash: String }

E::RelatedTo {
  From: Note, To: Task,
  Properties: { relation_type: String, confidence: F32 }
}
E::BelongsToProject {
  From: Task, To: Project,
  Properties: {}
}
E::MentionedIn {
  From: Email, To: Note,
  Properties: { relation_type: String }
}
E::LinkedTo {
  From: Note, To: Note,
  Properties: { link_type: String }
}
