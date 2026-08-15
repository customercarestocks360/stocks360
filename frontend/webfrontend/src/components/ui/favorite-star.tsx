import { useFavorites } from "@/components/FavoritesProvider";

export function FavoriteStar({ id, className = "" }: { id: string; className?: string }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const active = isFavorite(id);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleFavorite(id);
      }}
      aria-label={active ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={active}
      className={`shrink-0 text-sm transition-colors ${
        active ? "text-amber-400" : "text-muted-foreground/50 hover:text-amber-400"
      } ${className}`}
    >
      <i className={`${active ? "fa-solid" : "fa-regular"} fa-star`} />
    </button>
  );
}
