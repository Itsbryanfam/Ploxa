"use client";
import { useState, useTransition } from "react";
import { Plus, List } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { addItemToList, createList } from "@/lib/social/lists/server-actions";

interface UserList {
  id: string;
  title: string;
  slug: string;
  publishedAt: Date | null;
}

interface AddToListModalProps {
  gameId: number;
  gameTitle: string;
  userLists: UserList[];
}

/**
 * AddToListModal — client component.
 * Trigger button + Radix Dialog showing the user's lists.
 * "Create new list" inline option calls createList then addItemToList.
 * Clicking an existing list calls addItemToList directly.
 */
export function AddToListModal({
  gameId,
  gameTitle,
  userLists,
}: AddToListModalProps) {
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [lists, setLists] = useState<UserList[]>(userLists);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function handleAddToList(listId: string) {
    if (added.has(listId)) return;
    startTransition(async () => {
      const result = await addItemToList({ listId, gameId });
      if (result.ok) {
        setAdded((prev) => new Set(prev).add(listId));
      }
    });
  }

  function handleCreateAndAdd() {
    const title = newTitle.trim();
    if (!title) return;
    startTransition(async () => {
      const createResult = await createList({ title, isPublic: true });
      if (!createResult.ok) return;
      const addResult = await addItemToList({
        listId: createResult.listId,
        gameId,
      });
      if (addResult.ok) {
        const newList: UserList = {
          id: createResult.listId,
          title,
          slug: createResult.slug,
          publishedAt: null,
        };
        setLists((prev) => [newList, ...prev]);
        setAdded((prev) => new Set(prev).add(createResult.listId));
        setNewTitle("");
        setShowCreate(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-md border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          <List size={14} />
          Add to list
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add to list</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-[var(--text-dim)] -mt-2 truncate">
          {gameTitle}
        </p>

        <div className="space-y-1 max-h-64 overflow-y-auto">
          {lists.length === 0 && !showCreate && (
            <p className="text-sm text-[var(--text-dim)] py-2">
              No lists yet. Create one below.
            </p>
          )}

          {lists.map((list) => {
            const isDone = added.has(list.id);
            return (
              <button
                key={list.id}
                type="button"
                disabled={isPending || isDone}
                onClick={() => handleAddToList(list.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  isDone
                    ? "text-[var(--success)] cursor-default"
                    : "hover:bg-[var(--bg)] text-[var(--text)]"
                } disabled:opacity-60`}
              >
                {isDone ? "Added to " : ""}
                {list.title}
                {list.publishedAt ? null : (
                  <span className="ml-1 text-xs text-[var(--text-faint)]">
                    (draft)
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Create new list */}
        {showCreate ? (
          <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateAndAdd();
              }}
              placeholder="New list name"
              autoFocus
              className="flex-1 text-sm bg-transparent border-b border-[var(--border)] py-1 focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              disabled={isPending || !newTitle.trim()}
              onClick={handleCreateAndAdd}
              className="px-3 py-1 text-xs rounded bg-[var(--accent)] text-white disabled:opacity-50"
            >
              Create
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--text)] pt-2 border-t border-[var(--border)] transition-colors"
          >
            <Plus size={14} />
            Create new list
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
