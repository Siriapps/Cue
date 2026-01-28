/// <reference types="vite/client" />
/// <reference types="chrome" />

declare module "*.css?inline" {
  const content: string;
  export default content;
}
