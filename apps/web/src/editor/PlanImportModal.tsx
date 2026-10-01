import {
  Button,
  Group,
  Image,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconFileUpload } from "@tabler/icons-react";
import type { PlanImageInfo, PlanUploadResult } from "@wifi-planner/api-contract";
import {
  detectPaperSize,
  PAPER_SIZES,
  type PlanImage,
  pointsToMm,
  type ScaleCalibration,
  scaleFromRatio,
} from "@wifi-planner/domain";
import { updateFloor } from "@wifi-planner/domain/ops";
import { useState } from "react";
import { api } from "../api/client";
import { useSession } from "../collab/react";
import { notifyError } from "../notify";
import type { FloorEntry } from "./FloorPanel";

const ACCEPT = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};
const DPI_OPTIONS = ["100", "150", "200", "300"];
/** 元の用紙を指定しない（PDF の紙面のままの縮尺とみなす） */
const AS_PAGE = "page";

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
  const [ratio, setRatio] = useState<number | string>("");
  const [nominal, setNominal] = useState(AS_PAGE);

  const apply = (info: PlanImageInfo, ratioScale?: ScaleCalibration) => {
    const current = floor.plan;
    // 同じ元ファイルのラスタ化し直しなら、図面座標は変わらないので回転、トリミング、スケールを残す（設計書 3 章）
    const sameSource = current?.sourceSha256 === info.sourceSha256;
    const plan: PlanImage = {
      ...info,
      rotationDeg: sameSource ? current.rotationDeg : 0,
      crop: sameSource ? current.crop : undefined,
    };
    session.mutate((ydoc) =>
      updateFloor(ydoc, floor.id, {
        plan,
        ...(sameSource ? {} : { scale: undefined, alignment: undefined }),
        // 縮尺を指定したら、ラスタ化し直しでもその値で校正し直す
        ...(ratioScale ? { scale: ratioScale } : {}),
      }),
    );
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
  const ratioScale =
    pageInfo && typeof ratio === "number" && ratio > 0
      ? scaleFromRatio({
          ratio,
          pageWidthPt: pageInfo.widthPt,
          pageHeightPt: pageInfo.heightPt,
          nominal: PAPER_SIZES.find((p) => p.name === nominal),
        })
      : undefined;

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
            別のファイルに差し替えると、スケールと位置合わせの設定は消えます。
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
        <Stack gap={4}>
          <Group gap="xs" align="flex-end">
            <NumberInput
              label="縮尺（任意）"
              description="入力するとスケールを校正済みにします"
              leftSection={<Text size="sm">1 :</Text>}
              leftSectionWidth={36}
              min={1}
              decimalScale={2}
              w={180}
              value={ratio}
              onChange={setRatio}
            />
            <Select
              label="縮尺の基準の用紙"
              w={200}
              allowDeselect={false}
              data={[
                {
                  value: AS_PAGE,
                  label: `PDF の紙面（${paperLabel(pageInfo.widthPt, pageInfo.heightPt)}）`,
                },
                ...PAPER_SIZES.map((p) => ({ value: p.name, label: `${p.name}（縮小前）` })),
              ]}
              value={nominal}
              onChange={(v) => setNominal(v ?? AS_PAGE)}
            />
          </Group>
          {ratioScale && (
            <Text size="xs" c="dimmed">
              紙面の幅 {Math.round(pointsToMm(pageInfo.widthPt))} mm が実際の{" "}
              {ratioScale.distanceM.toFixed(2)} m に当たります
            </Text>
          )}
        </Stack>
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

/** ページの寸法を「A3 横、420×297 mm」のように表す */
function paperLabel(widthPt: number, heightPt: number): string {
  const mm = `${Math.round(pointsToMm(widthPt))}×${Math.round(pointsToMm(heightPt))} mm`;
  const paper = detectPaperSize(widthPt, heightPt);
  if (!paper) return mm;
  return `${paper.name} ${widthPt >= heightPt ? "横" : "縦"}、${mm}`;
}
