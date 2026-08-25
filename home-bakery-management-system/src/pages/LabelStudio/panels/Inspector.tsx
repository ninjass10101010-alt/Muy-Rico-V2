import type { BusinessProfile } from "../../../types";
import { selectSelected, useEditorStore } from "../state";
import DocumentInspector from "./DocumentInspector";
import ElementInspector from "./ElementInspector";

interface Props {
  profile: BusinessProfile;
}

/** Right-column (desktop) / bottom-drawer (<lg) inspector. */
export default function Inspector({ profile }: Props) {
  const selection = useEditorStore((s) => s.selection);
  const selected = useEditorStore(selectSelected);

  if (selection === null || !selected) {
    return <DocumentInspector profile={profile} />;
  }
  return <ElementInspector el={selected} />;
}
