import { addComment } from "@/app/(portal)/deposits/actions";
import { displayName, formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/labels";
import type { Comment } from "@/lib/types";
import { ActionForm, SubmitButton } from "./action-form";

export function CommentThread({
  comments,
  depositId,
  releaseRequestId,
  canComment = true,
}: {
  comments: Comment[];
  depositId?: string;
  releaseRequestId?: string;
  canComment?: boolean;
}) {
  return (
    <div>
      {comments.length === 0 ? (
        <p className="text-sm text-slate-500">No comments yet.</p>
      ) : (
        <ol className="space-y-4">
          {comments.map((c) => {
            const decision = c.body.match(/^\[(Verify|Return|Reject|Approve)\] /);
            return (
              <li key={c.id} className="flex gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {displayName(c.author).slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">
                    <span className="font-medium text-slate-800">{displayName(c.author)}</span>
                    {c.author?.role && ` · ${ROLE_LABELS[c.author.role]}`} · {formatDateTime(c.created_at)}
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-slate-800">
                    {decision && (
                      <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                        {decision[1]}
                      </span>
                    )}
                    {decision ? c.body.slice(decision[0].length) : c.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {canComment && (
        <ActionForm action={addComment} resetOnSuccess hideOk className="mt-5">
          {depositId && <input type="hidden" name="deposit_id" value={depositId} />}
          {releaseRequestId && <input type="hidden" name="release_request_id" value={releaseRequestId} />}
          <label className="sr-only" htmlFor="comment-body">
            Comment
          </label>
          <textarea
            id="comment-body"
            name="body"
            rows={2}
            maxLength={4000}
            required
            className="input"
            placeholder="Add a comment or clarification…"
          />
          <div className="mt-2 flex justify-end">
            <SubmitButton size="sm" variant="secondary">
              Post comment
            </SubmitButton>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
