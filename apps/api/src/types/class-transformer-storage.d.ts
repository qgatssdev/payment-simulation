/**
 * class-transformer exposes its metadata storage (needed to resolve @Type() for nested DTOs
 * when generating JSON Schemas) only by deep import, and ships its types in a separate folder.
 */
declare module 'class-transformer/cjs/storage' {
  export { defaultMetadataStorage } from 'class-transformer/types/storage';
}
