import {
  Button,
  Group,
  Image,
  Loader,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconFileUpload } from "@tabler/icons-react";
import type { PlanImageInfo, PlanUploadResult } from "@wifi-planner/api-contract";
import type { PlanImage, ScaleCalibration } from "@wifi-planner/domain";
import { clearPlanOffsets, updateFloor } from "@wifi-planner/domain/ops";
import { useState } from "react";
import { api } from "../api/client";
import { useSession } from "../collab/react";
import { notifyError } from "../notify";
import type { FloorEntry } from "./FloorPanel";
import { EMPTY_RATIO, paperLabel, RatioScaleFields, ratioToScale } from "./RatioScaleFields";

const ACCEPT = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};
const DPI_OPTIONS = ["100", "150", "200", "300"];

/** 図面の取り込み（FR-2.1、FR-2.2） */
export function PlanImportModal(props: { floor: FloorEntry | undefined; onClose: () => void }) {
  return (
    <Modal opened={!!props.floor} onClose={props.onClose} title="図面の取り込み" size="lg">
      {props.floor && <ImportBody floor={props.floor} onDone={props.onClose} />}
    </Modal>
  );
}

function ImportBody({ floor, onDone }: { floor: FloorEntry; onDone: () => void }) {
  const session = useSession();
  const projectId = session.projectId;
  const [uploading, setUploading] = useState(false);
  const [pdf, setPdf] = useState<Extract<PlanUploadResult, { kind: "pdf" }>>();
  const [page, setPage] = useState(1);
  const [dpi, setDpi] = useState("200");
  const [rasterizing, setRasterizing] = useState(false);
  const [ratio, setRatio] = useState(EMPTY_RATIO);

  const apply = (info: PlanImageInfo, ratioScale?: ScaleCalibration) => {
    const current = floor.plan;
    // 同じ元ファイルの同じページのラスタ化し直しなら、図面座標は変わらないので回転、トリミング、スケールを残す（設計書 3 章）。
    // 同じ PDF でも別のページなら、別の図面として扱う
    const sameSource = current?.sourceSha256 === info.sourceSha256 && current.page === info.page;
    const plan: PlanImage = {
      ...info,
      rotationDeg: sameSource ? current.rotationDeg : 0,
      crop: sameSource ? current.crop : undefined,
    };
    session.mutate((ydoc) => {
      updateFloor(ydoc, floor.id, {
        plan,
        ...(sameSource ? {} : { scale: undefined }),
        // 縮尺を指定したら、ラスタ化し直しでもその値で校正し直す
        ...(ratioScale ? { scale: ratioScale } : {}),
      });
      // 位置合わせは、このフロアのものも、ほかのフロアをこのフロアに合わせたものも消す
      if (!sameSource) clearPlanOffsets(ydoc, floor.id);
    });
    onDone();
  };

  const onDrop = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.upload<PlanUploadResult>(`/projects/${projectId}/plans`, file);
      if (result.kind === "image") apply(result.plan);
      else {
        setPdf(result);
        setPage(1);
      }
    } catch (e) {
      notifyError(e);
    } finally {
      setUploading(false);
    }
  };

  const pageInfo = pdf?.pages[page - 1];
  const ratioScale = pageInfo && ratioToScale(ratio, pageInfo);

  const rasterize = async () => {
    if (!pdf) return;
    setRasterizing(true);
    try {
      apply(
        await api.post<PlanImageInfo>(
          `/projects/${projectId}/plans/${pdf.sourceSha256}/rasterize`,
          {
            page,
            dpi: Number(dpi),
          },
        ),
        ratioScale,
      );
    } catch (e) {
      notifyError(e);
    } finally {
      setRasterizing(false);
    }
  };

  if (!pdf) {
    return (
      <Stack>
        {floor.plan && (
          <Text size="sm" c="dimmed">
            別のファイルや別のページに差し替えると、スケールと、このフロアに関わる位置合わせの設定は消えます。
          </Text>
        )}
        <Dropzone onDrop={onDrop} accept={ACCEPT} multiple={false} loading={uploading}>
          <Stack align="center" gap="xs" py="xl">
            <IconFileUpload size={40} stroke={1.5} />
            <Text>PDF、PNG、JPEG をここにドロップするか、クリックして選ぶ</Text>
          </Stack>
        </Dropzone>
      </Stack>
    );
  }

  return (
    <Stack>
      <Text size="sm">ページを選んでください（{pdf.pages.length} ページ）</Text>
      <SimpleGrid cols={4} spacing="xs" mah={360} style={{ overflowY: "auto" }}>
        {pdf.pages.map((p, i) => {
          const n = i + 1;
          return (
            <UnstyledButton
              key={n}
              onClick={() => setPage(n)}
              aria-label={`${n} ページ`}
              aria-pressed={page === n}
              style={{
                border: `2px solid ${page === n ? "var(--mantine-color-blue-6)" : "var(--mantine-color-default-border)"}`,
                borderRadius: 4,
                padding: 4,
              }}
            >
              <Image
                src={`/api/projects/${projectId}/plans/${pdf.sourceSha256}/pages/${n}/thumbnail`}
                alt=""
                fit="contain"
                h={100}
                fallbackSrc=""
              />
              <Text size="xs" ta="center">
                {n}（{paperLabel(p.widthPt, p.heightPt)}）
              </Text>
            </UnstyledButton>
          );
        })}
      </SimpleGrid>
      {pageInfo && (
        <RatioScaleFields
          page={pageInfo}
          value={ratio}
          onChange={setRatio}
          ratioLabel="縮尺（任意）"
          ratioDescription="入力するとスケールを校正済みにします"
        />
      )}
      <Group justify="space-between">
        <Group gap="xs">
          <Text size="sm">解像度</Text>
          <SegmentedControl
            data={DPI_OPTIONS.map((d) => ({ value: d, label: `${d} dpi` }))}
            value={dpi}
            onChange={setDpi}
          />
        </Group>
        <Button
          onClick={rasterize}
          loading={rasterizing}
          leftSection={rasterizing ? <Loader size="xs" /> : undefined}
        >
          取り込む
        </Button>
      </Group>
    </Stack>
  );
}
