import { AppError } from "@clearledger/shared";
import type { Prisma } from "@clearledger/db";
import { z } from "zod";

export const customerAddressRoleSchema = z.enum(["BILLING", "SHIPPING", "SERVICE"]);

const addressText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();
const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/);

/**
 * The legacy province/country names remain accepted at the request boundary so existing
 * clients can move forward without a data-loss window. They are normalized to ISO names
 * before persistence; new clients should send subdivisionCode and countryCode.
 */
export const customerAddressSchema = z
  .object({
    role: customerAddressRoleSchema.optional(),
    recipientName: addressText(200),
    organization: addressText(200),
    line1: z.string().trim().min(1).max(200),
    line2: addressText(200),
    city: z.string().trim().min(1).max(120),
    subdivisionCode: addressText(10),
    province: addressText(80),
    postalCode: z.string().trim().min(3).max(20),
    countryCode: countryCode.optional(),
    country: countryCode.optional(),
    phone: addressText(40),
    email: z.string().trim().pipe(z.email()).nullable().optional(),
    isDefault: z.boolean().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const resolvedCountry = value.countryCode ?? value.country;
    const resolvedSubdivision = value.subdivisionCode ?? value.province;
    if (!resolvedCountry) {
      context.addIssue({
        code: "custom",
        path: ["countryCode"],
        message: "countryCode is required."
      });
      return;
    }
    if (value.countryCode && value.country && value.countryCode !== value.country)
      context.addIssue({
        code: "custom",
        path: ["countryCode"],
        message: "countryCode and country must identify the same country."
      });
    if (value.subdivisionCode && value.province && value.subdivisionCode !== value.province)
      context.addIssue({
        code: "custom",
        path: ["subdivisionCode"],
        message: "subdivisionCode and province must identify the same subdivision."
      });
    if (resolvedCountry === "CA" || resolvedCountry === "US") {
      if (!resolvedSubdivision) {
        context.addIssue({
          code: "custom",
          path: ["subdivisionCode"],
          message: `subdivisionCode is required for ${resolvedCountry} addresses.`
        });
      } else {
        try {
          normalizeSubdivisionCode(resolvedCountry, resolvedSubdivision);
        } catch (error) {
          context.addIssue({
            code: "custom",
            path: ["subdivisionCode"],
            message: error instanceof Error ? error.message : "Subdivision code is invalid."
          });
        }
      }
      const postal = value.postalCode.toUpperCase();
      const validPostal =
        resolvedCountry === "CA"
          ? /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/.test(postal)
          : /^\d{5}(?:-\d{4})?$/.test(postal);
      if (!validPostal)
        context.addIssue({
          code: "custom",
          path: ["postalCode"],
          message:
            resolvedCountry === "CA"
              ? "postalCode must be a Canadian postal code (for example, T2P 1J9)."
              : "postalCode must be a US ZIP code (for example, 90210 or 90210-1234)."
        });
    }
  });

export type CustomerAddressInput = z.infer<typeof customerAddressSchema>;

export interface NormalizedCustomerAddress {
  readonly role: "BILLING" | "SHIPPING" | "SERVICE";
  readonly recipientName: string | null;
  readonly organization: string | null;
  readonly line1: string | null;
  readonly line2: string | null;
  readonly city: string | null;
  readonly subdivisionCode: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly isDefault: boolean;
}

export function normalizeCustomerAddress(
  input: CustomerAddressInput,
  defaultRole?: NormalizedCustomerAddress["role"]
): NormalizedCustomerAddress {
  const parsed = customerAddressSchema.parse(input);
  const resolvedCountry = (parsed.countryCode ?? parsed.country ?? "").toUpperCase();
  const resolvedSubdivision = parsed.subdivisionCode ?? parsed.province ?? null;
  return {
    role: parsed.role ?? defaultRole ?? "SHIPPING",
    recipientName: parsed.recipientName ?? null,
    organization: parsed.organization ?? null,
    line1: parsed.line1,
    line2: parsed.line2 ?? null,
    city: parsed.city,
    subdivisionCode: resolvedSubdivision
      ? normalizeSubdivisionCode(resolvedCountry, resolvedSubdivision)
      : null,
    postalCode: parsed.postalCode.toUpperCase(),
    countryCode: resolvedCountry,
    phone: parsed.phone ?? null,
    email: parsed.email ?? null,
    isDefault: parsed.isDefault ?? false
  };
}

export function assertCustomerAddress(
  input: CustomerAddressInput,
  field = "address"
): NormalizedCustomerAddress {
  try {
    return normalizeCustomerAddress(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const path = issue?.path.length ? issue.path.join(".") : field;
      throw new AppError(
        "ADDRESS_INVALID",
        `${path}: ${issue?.message ?? "Address is invalid."}`,
        422,
        { field: path, issues: error.issues }
      );
    }
    throw error;
  }
}

export interface CustomerAddressRowLike {
  readonly role: string;
  readonly recipientName: string | null;
  readonly organization: string | null;
  readonly line1: string | null;
  readonly line2: string | null;
  readonly city: string | null;
  readonly subdivisionCode: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly isDefault: boolean;
  readonly needsReview: boolean;
  readonly legacyValue?: unknown;
}

export function addressSnapshot(
  addresses: readonly CustomerAddressRowLike[] | undefined,
  role: CustomerAddressRowLike["role"]
): Prisma.InputJsonObject | null {
  const address = addresses
    ?.filter((candidate) => candidate.role === role && !candidate.needsReview)
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))[0];
  if (!address || !address.line1 || !address.city || !address.postalCode || !address.countryCode)
    return null;
  return {
    recipientName: address.recipientName,
    organization: address.organization,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    province: address.subdivisionCode,
    subdivisionCode: address.subdivisionCode,
    postalCode: address.postalCode,
    country: address.countryCode,
    countryCode: address.countryCode,
    phone: address.phone,
    email: address.email
  };
}

export function addressDto(row: CustomerAddressRowLike) {
  return {
    ...row,
    legacyValue: row.needsReview ? (row.legacyValue ?? null) : undefined
  };
}

const subdivisions: Readonly<Record<"CA" | "US", ReadonlySet<string>>> = {
  CA: new Set([
    "CA-AB",
    "CA-BC",
    "CA-MB",
    "CA-NB",
    "CA-NL",
    "CA-NS",
    "CA-NT",
    "CA-NU",
    "CA-ON",
    "CA-PE",
    "CA-QC",
    "CA-SK",
    "CA-YT"
  ]),
  US: new Set([
    "US-AK",
    "US-AL",
    "US-AR",
    "US-AZ",
    "US-CA",
    "US-CO",
    "US-CT",
    "US-DC",
    "US-DE",
    "US-FL",
    "US-GA",
    "US-HI",
    "US-IA",
    "US-ID",
    "US-IL",
    "US-IN",
    "US-KS",
    "US-KY",
    "US-LA",
    "US-MA",
    "US-MD",
    "US-ME",
    "US-MI",
    "US-MN",
    "US-MO",
    "US-MS",
    "US-MT",
    "US-NC",
    "US-ND",
    "US-NE",
    "US-NH",
    "US-NJ",
    "US-NM",
    "US-NV",
    "US-NY",
    "US-OH",
    "US-OK",
    "US-OR",
    "US-PA",
    "US-RI",
    "US-SC",
    "US-SD",
    "US-TN",
    "US-TX",
    "US-UT",
    "US-VA",
    "US-VT",
    "US-WA",
    "US-WI",
    "US-WV",
    "US-WY"
  ])
};

function normalizeSubdivisionCode(country: string, value: string): string {
  const trimmed = value.trim().toUpperCase();
  const candidate = trimmed.includes("-") ? trimmed : `${country}-${trimmed}`;
  if (country === "CA" || country === "US") {
    if (!subdivisions[country].has(candidate))
      throw new Error(`subdivisionCode must be a valid ISO 3166-2 ${country} code.`);
  } else if (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(candidate)) {
    throw new Error("subdivisionCode must use an ISO 3166-2 code.");
  }
  return candidate;
}
