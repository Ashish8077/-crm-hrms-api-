import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class AddressSubdocument {
  @Prop({ type: String, trim: true, default: null })
  street?: string | null;

  @Prop({ type: String, trim: true, default: null })
  city?: string | null;

  @Prop({ type: String, trim: true, default: null })
  state?: string | null;

  @Prop({ type: String, trim: true, default: null })
  postalCode?: string | null;

  @Prop({ type: String, trim: true, default: null })
  country?: string | null;
}

export const AddressSubdocumentSchema = SchemaFactory.createForClass(AddressSubdocument);
