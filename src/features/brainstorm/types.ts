export type BrainstormPosition = {
  x: number;
  y: number;
};

export type BrainstormEntry = {
  id: string;
  templateId: string;
  name: string;
  fields: Record<string, string>;
  position?: BrainstormPosition;
  createdAt: string;
  updatedAt: string;
};

export type BrainstormEdge = {
  id: string;
  source: string;
  target: string;
};

export type BrainstormDocument = {
  entries: BrainstormEntry[];
  edges: BrainstormEdge[];
  updatedAt: string;
};

export type BrainstormViewOption = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
