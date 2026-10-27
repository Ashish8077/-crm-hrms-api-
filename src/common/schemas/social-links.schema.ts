import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class SocialLinksSubdocument {
  @Prop({ type: String, trim: true, default: null })
  linkedin?: string | null;

  @Prop({ type: String, trim: true, default: null })
  twitter?: string | null;

  @Prop({ type: String, trim: true, default: null })
  facebook?: string | null;

  @Prop({ type: String, trim: true, default: null })
  github?: string | null;
}

export const SocialLinksSubdocumentSchema = SchemaFactory.createForClass(
  SocialLinksSubdocument,
);
