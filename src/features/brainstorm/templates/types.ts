export type TemplateField = {
  key: string;
  label: string;
  placeholder: string;
  multiline: boolean;
};

export type BrainstormTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  fields: TemplateField[];
};
