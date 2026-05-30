type MaterialIconProps = {
  name: string;
  className?: string;
};

export function MaterialIcon({ name, className }: MaterialIconProps) {
  return (
    <span className={["material-symbols-outlined", className].filter(Boolean).join(" ")}>
      {name}
    </span>
  );
}
