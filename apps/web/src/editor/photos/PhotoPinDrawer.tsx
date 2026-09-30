import {
  ActionIcon,
  Button,
  Card,
  Drawer,
  Group,
  Image,
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  UnstyledButton,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconCamera, IconTrash } from "@tabler/icons-react";
import type { PhotoUploadResult } from "@wifi-planner/api-contract";
import type { PhotoPin } from "@wifi-planner/domain";
import { deletePhotoPin, updatePhotoPin } from "@wifi-planner/domain/ops";
import { useState } from "react";
import { api, fileUrl } from "../../api/client";
import { useSession, useSessionState } from "../../collab/react";
import { notifyError } from "../../notify";

type Photo = PhotoPin["photos"][number];

/** 写真の日時を読みやすくする。タイムゾーンのない現地時刻なので、Date に通さずに整形する */
export function formatTakenAt(takenAt: string | undefined): string | undefined {
  const m = takenAt?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : undefined;
}

/** ピンの写真の一覧と、写真ごとの撮影方向とメモ（FR-9.1〜9.4） */
export function PhotoPinDrawer(props: {
  floorId: string;
  pinId: string | undefined;
  onClose: () => void;
}) {
  const session = useSession();
  const { doc } = useSessionState();
  const readOnly = session.readOnly;
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<Photo>();
  const pin = props.pinId ? doc?.floors[props.floorId]?.photoPins[props.pinId] : undefined;

  const setPhotos = (photos: Photo[], coalesce = false) =>
    props.pinId &&
    session.mutate((ydoc) => updatePhotoPin(ydoc, props.floorId, props.pinId!, { photos }), {
      coalesce,
    });

  const upload = async (files: File[]) => {
    if (!props.pinId) return;
    setUploading(true);
    try {
      const results = await Promise.all(
        files.map((f) => api.upload<PhotoUploadResult>(`/projects/${session.projectId}/photos`, f)),
      );
      // アップロードの間にほかのユーザーが変えた内容を失わないよう、最新の文書から読み直して追記する
      session.mutate((ydoc) => {
        const map = ydoc.getMap("floors").get(props.floorId) as
          | import("yjs").Map<unknown>
          | undefined;
        const pins = map?.get("photoPins") as
          | import("yjs").Map<import("yjs").Map<unknown>>
          | undefined;
        const current = (pins?.get(props.pinId!)?.get("photos") as Photo[] | undefined) ?? [];
        updatePhotoPin(ydoc, props.floorId, props.pinId!, {
          photos: [...current, ...results.map((r) => ({ ...r, memo: "" }))],
        });
      });
    } catch (e) {
      notifyError(e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Drawer
      opened={!!pin}
      onClose={() => {
        setViewing(undefined);
        props.onClose();
      }}
      position="right"
      title="現場写真"
      size={viewing ? "xl" : "md"}
    >
      {/* 拡大表示（FR-9.3）はドロワーの中で行う。モーダルを重ねるとドロワーの後ろに隠れるため */}
      {pin && viewing && (
        <Stack>
          <Button
            variant="subtle"
            size="xs"
            onClick={() => setViewing(undefined)}
            style={{ alignSelf: "flex-start" }}
          >
            一覧に戻る
          </Button>
          <Image
            src={fileUrl(session.projectId, viewing.sha256)}
            mah="75vh"
            fit="contain"
            alt={viewing.memo || "現場写真"}
          />
          <Text size="xs" c="dimmed">
            撮影日時：{formatTakenAt(viewing.takenAt) ?? "不明"}
            {viewing.directionDeg !== undefined && `／撮影方向 ${viewing.directionDeg}°`}
          </Text>
          {viewing.memo && <Text size="sm">{viewing.memo}</Text>}
        </Stack>
      )}
      {pin && !viewing && (
        <Stack>
          {!readOnly && (
            <Dropzone
              onDrop={upload}
              accept={["image/jpeg", "image/png", "image/heic"]}
              loading={uploading}
            >
              <Group justify="center" gap="xs" py="md">
                <IconCamera size={24} />
                <Text size="sm">写真をドロップするか、クリックして選ぶ（複数可）</Text>
              </Group>
            </Dropzone>
          )}
          {pin.photos.length === 0 && (
            <Text size="sm" c="dimmed">
              写真がありません
            </Text>
          )}
          <SimpleGrid cols={1}>
            {pin.photos.map((photo, i) => (
              // 同じ写真を 2 回アップロードすると内容のハッシュが重なるので、並びの番号も使う
              // biome-ignore lint/suspicious/noArrayIndexKey: 同じ写真が 2 枚あっても区別するため
              <Card key={`${photo.sha256}-${i}`} withBorder padding="xs">
                <Group align="flex-start" wrap="nowrap">
                  <UnstyledButton
                    onClick={() => setViewing(photo)}
                    aria-label={`写真 ${i + 1} を拡大`}
                  >
                    <Image
                      src={fileUrl(session.projectId, photo.thumbSha256)}
                      w={120}
                      h={90}
                      fit="cover"
                      radius="sm"
                      alt=""
                    />
                  </UnstyledButton>
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Text size="xs" c="dimmed">
                      撮影日時：{formatTakenAt(photo.takenAt) ?? "不明"}
                    </Text>
                    <NumberInput
                      size="xs"
                      label="撮影方向（図面の上が 0°、時計回り）"
                      suffix="°"
                      min={0}
                      max={359}
                      value={photo.directionDeg ?? ""}
                      placeholder="未設定"
                      disabled={readOnly}
                      onChange={(v) =>
                        setPhotos(
                          pin.photos.map((p, j) =>
                            j === i
                              ? {
                                  ...p,
                                  directionDeg:
                                    typeof v === "number" ? ((v % 360) + 360) % 360 : undefined,
                                }
                              : p,
                          ),
                          true,
                        )
                      }
                    />
                    <Textarea
                      size="xs"
                      label="メモ"
                      autosize
                      minRows={1}
                      defaultValue={photo.memo}
                      disabled={readOnly}
                      onBlur={(e) => {
                        const memo = e.currentTarget.value;
                        if (memo !== photo.memo)
                          setPhotos(pin.photos.map((p, j) => (j === i ? { ...p, memo } : p)));
                      }}
                    />
                  </Stack>
                  {!readOnly && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`写真 ${i + 1} を削除`}
                      onClick={() => setPhotos(pin.photos.filter((_, j) => j !== i))}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Group>
              </Card>
            ))}
          </SimpleGrid>
          {!readOnly && (
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={() => {
                if (props.pinId)
                  session.mutate((ydoc) => deletePhotoPin(ydoc, props.floorId, props.pinId!));
                props.onClose();
              }}
            >
              このピンを削除
            </Button>
          )}
        </Stack>
      )}
    </Drawer>
  );
}
