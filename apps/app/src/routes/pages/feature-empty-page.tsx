import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import type { FeatureLayoutKey } from "../../features/layout/panel-events";

type Props = {
  feature: FeatureLayoutKey;
  title: string;
};

export function FeatureEmptyPage({ feature, title }: Props) {
  return (
    <FeaturePanelsShell
      feature={feature}
      center={
        <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
          <h2>{title}</h2>
          <p>Coming soon.</p>
        </div>
      }
    />
  );
}
