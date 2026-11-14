import { Composition } from "remotion";
import { CUT, Demo } from "./Demo";

export const RemotionRoot: React.FC = () => {
  return <Composition id="Demo" component={Demo} durationInFrames={CUT.total} fps={30} width={1920} height={1080} />;
};
