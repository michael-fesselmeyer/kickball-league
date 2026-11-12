import {
  serializeJsonLd,
  type JsonLd as Data,
} from "@/lib/seo/structured-data";

/** Structured data for search engines; renders nothing visible. */
export function JsonLd({ data }: { data: Data | readonly Data[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
