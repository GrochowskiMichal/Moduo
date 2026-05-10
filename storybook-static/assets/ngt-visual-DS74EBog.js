import{j as r}from"./jsx-runtime-u17CrQMm.js";import{F as n}from"./framework-poster-CXGAnNfZ.js";function t(e){return r.jsx(n,{...e,style:{mode:"steps",accent:"#4ade80",panel:"#1a2b22",glow:"rgba(74,222,128,.32)"}})}t.__docgenInfo={description:"",methods:[],displayName:"NgtVisual",props:{template:{required:!0,tsType:{name:"signature",type:"object",raw:`{
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  fields: TemplateField[];
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"icon",value:{name:"string",required:!0}},{key:"color",value:{name:"string",required:!0}},{key:"fields",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  key: string;
  label: string;
  placeholder: string;
  multiline: boolean;
}`,signature:{properties:[{key:"key",value:{name:"string",required:!0}},{key:"label",value:{name:"string",required:!0}},{key:"placeholder",value:{name:"string",required:!0}},{key:"multiline",value:{name:"boolean",required:!0}}]}}],raw:"TemplateField[]",required:!0}}]}},description:""},entry:{required:!0,tsType:{name:"signature",type:"object",raw:`{
  id: string;
  templateId: string;
  name: string;
  fields: Record<string, string>;
  position?: BrainstormPosition;
  createdAt: string;
  updatedAt: string;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"templateId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"fields",value:{name:"Record",elements:[{name:"string"},{name:"string"}],raw:"Record<string, string>",required:!0}},{key:"position",value:{name:"signature",type:"object",raw:`{
  x: number;
  y: number;
}`,signature:{properties:[{key:"x",value:{name:"number",required:!0}},{key:"y",value:{name:"number",required:!0}}]},required:!1}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}}]}},description:""},onUpdateName:{required:!0,tsType:{name:"signature",type:"function",raw:"(value: string) => void",signature:{arguments:[{type:{name:"string"},name:"value"}],return:{name:"void"}}},description:""},onUpdateField:{required:!0,tsType:{name:"signature",type:"function",raw:"(key: string, value: string) => void",signature:{arguments:[{type:{name:"string"},name:"key"},{type:{name:"string"},name:"value"}],return:{name:"void"}}},description:""}}};export{t as N};
