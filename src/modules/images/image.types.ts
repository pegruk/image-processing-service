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
  deleteOwnedById(imageId: string, userId: string): Promise<{ image: Image; variants: ImageVariant[] } | null>;
  createVariant(input: NewImageVariant): Promise<ImageVariant>;
  findOwnedVariant(variantId: string, userId: string): Promise<ImageVariant | null>;
}

export type CreateImageInput = NewImage;
