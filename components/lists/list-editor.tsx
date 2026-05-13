"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, X } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  removeItemFromList,
  reorderListItems,
  updateList,
  publishList,
} from "@/lib/social/lists/server-actions";

type Item = {
  gameId: number;
  position: number;
  note: string | null;
  game: { slug: string; title: string; coverUrl: string | null };
};

function SortableRow(props: { item: Item; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: props.item.gameId });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab text-[var(--text-dim)] hover:text-[var(--text)] touch-none p-1"
      >
        <GripVertical size={16} />
      </button>

      {props.item.game.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- RAWG/Supabase URLs not in remotePatterns
        <img
          src={props.item.game.coverUrl}
          alt=""
          width={40}
          height={56}
          className="rounded shrink-0"
          style={{ width: 40, height: 56, objectFit: "cover" }}
        />
      ) : (
        <div
          className="rounded bg-[var(--bg)] shrink-0"
          style={{ width: 40, height: 56 }}
        />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{props.item.game.title}</p>
        {props.item.note && (
          <p className="text-xs text-[var(--text-dim)] truncate mt-0.5">
            {props.item.note}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={props.onRemove}
        aria-label="Remove"
        className="p-1 rounded hover:bg-[var(--bg)]"
      >
        <X size={16} />
      </button>
    </li>
  );
}

export function ListEditor(props: {
  list: {
    id: string;
    title: string;
    description: string | null;
    isPublic: boolean;
    publishedAt: Date | null;
  };
  initialItems: Item[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(props.initialItems);
  const [title, setTitle] = useState(props.list.title);
  const [description, setDescription] = useState(props.list.description ?? "");
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.gameId === active.id);
      const newIndex = prev.findIndex((i) => i.gameId === over.id);
      const next = arrayMove(prev, oldIndex, newIndex);
      startTransition(async () => {
        const result = await reorderListItems({
          listId: props.list.id,
          orderedGameIds: next.map((i) => i.gameId),
        });
        if (!result.ok) {
          // Server rejected — re-sync from authoritative state.
          router.refresh();
        }
      });
      return next;
    });
  }

  function onRemove(gameId: number) {
    setItems((prev) => prev.filter((i) => i.gameId !== gameId));
    startTransition(async () => {
      const result = await removeItemFromList({ listId: props.list.id, gameId });
      if (!result.ok) {
        // Server rejected — re-sync from authoritative state.
        router.refresh();
      }
    });
  }

  function onSaveMeta() {
    startTransition(async () => {
      await updateList({ listId: props.list.id, title, description });
    });
  }

  function onPublish() {
    startTransition(async () => {
      const result = await publishList(props.list.id);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={onSaveMeta}
        placeholder="List title"
        className="w-full text-2xl font-bold bg-transparent border-b border-[var(--border)] py-2 focus:outline-none focus:border-[var(--accent)]"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={onSaveMeta}
        placeholder="Optional description"
        rows={2}
        className="w-full text-sm bg-transparent border-b border-[var(--border)] py-2 focus:outline-none focus:border-[var(--accent)] resize-none"
      />

      {items.length === 0 && (
        <p className="text-sm text-[var(--text-dim)]">
          Add games from any game page using the &quot;Add to list&quot; button.
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={items.map((i) => i.gameId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {items.map((item) => (
              <SortableRow
                key={item.gameId}
                item={item}
                onRemove={() => onRemove(item.gameId)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)]">
        {!props.list.publishedAt && (
          <button
            type="button"
            onClick={onPublish}
            className="px-4 py-2 text-sm rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            Publish
          </button>
        )}
        {props.list.publishedAt && (
          <span className="text-xs text-[var(--success)] self-center">
            Published
          </span>
        )}
      </div>
    </div>
  );
}
