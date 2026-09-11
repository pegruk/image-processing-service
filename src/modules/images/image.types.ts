import type {
  Image,
  ImageVariant,
  NewImage,
  NewImageVariant,
} from '../../infrastructure/database/schema';

export interface ImageListOptions {
  offset: number;
  limit: number;
}

export interface ImageListResult {
  items: Image[];
  total: number;
}

export interface ImageRepository {
  create(input: NewImage): Promise<Image>;
  findOwnedById(imageId: string, userId: string): Promise<Image | null>;
  listOwned(userId: string, options: ImageListOptions): Promise<ImageListResult>;
  claimDeletion(imageId: string, userId: string): Promise<{ image: Image; variants: ImageVariant[] } | null>;
  finalizeDeletion(imageId: string, userId: string): Promise<boolean>;
  reserveStorage(userId: string, bytes: number, quota: number): Promise<boolean>;
  releaseStorage(userId: string, bytes: number): Promise<void>;
  createVariant(input: NewImageVariant): Promise<ImageVariant>;
  findOwnedVariant(variantId: string, userId: string): Promise<ImageVariant | null>;
}

export type CreateImageInput = NewImage;
