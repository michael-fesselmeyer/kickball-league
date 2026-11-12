import { waiverBlocks } from "@/domain/waiver/waiver";

/** A waiver's full text. Its Markdown subset is rendered as text, never HTML. */
export function WaiverText({ body }: { body: string }) {
  return (
    <div className="flex flex-col gap-3">
      {waiverBlocks(body).map((block, i) =>
        block.kind === "heading" ? (
          <h3 key={i} className="text-h3">
            {block.text}
          </h3>
        ) : block.kind === "list" ? (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-6">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{block.text}</p>
        ),
      )}
    </div>
  );
}
