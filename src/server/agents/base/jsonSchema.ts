import type { ZodSchema, ZodTypeAny } from "zod";
import { z } from "zod";

/**
 * Minimal zod -> JSON Schema converter sufficient for OpenAI structured output
 * and tool definitions. Handles the subset of zod we actually use in agent
 * schemas: object/array/string/number/boolean/enum/optional/nullable/literal/union.
 */
export function zodToJsonSchema(schema: ZodSchema): Record<string, unknown> {
  return convert(schema as ZodTypeAny);
}

function convert(schema: ZodTypeAny): Record<string, unknown> {
  const def = (schema as { _def: { typeName: string } })._def;

  switch (def.typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNull":
      return { type: "null" };
    case "ZodLiteral": {
      const lit = (schema as unknown as z.ZodLiteral<string | number | boolean>).value;
      return { const: lit };
    }
    case "ZodEnum":
      return {
        type: "string",
        enum: (schema as unknown as z.ZodEnum<[string, ...string[]]>).options,
      };
    case "ZodArray":
      return {
        type: "array",
        items: convert((schema as unknown as z.ZodArray<ZodTypeAny>).element),
      };
    case "ZodObject": {
      const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const child = value as ZodTypeAny;
        properties[key] = convert(child);
        if (!child.isOptional()) required.push(key);
      }
      return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
    }
    case "ZodOptional":
    case "ZodDefault":
      return convert((schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType);
    case "ZodNullable": {
      const inner = convert((schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType);
      // Allow null alongside the inner type. Works in OpenAI's structured-output mode.
      const t = (inner as { type?: unknown }).type;
      if (typeof t === "string") return { ...inner, type: [t, "null"] };
      return { anyOf: [inner, { type: "null" }] };
    }
    case "ZodUnion": {
      const opts = (schema as unknown as z.ZodUnion<readonly [ZodTypeAny, ...ZodTypeAny[]]>)
        .options;
      return { anyOf: opts.map((o) => convert(o)) };
    }
    case "ZodRecord":
      return { type: "object", additionalProperties: true };
    default:
      return {};
  }
}
