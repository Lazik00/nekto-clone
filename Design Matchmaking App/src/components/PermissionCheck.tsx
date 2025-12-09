import { useState, useEffect } from "react";
import {
  Camera,
  Mic,
  AlertCircle,
  CheckCircle,
  XCircle
} from "lucide-react";

type PermissionStatus = "checking" | "granted" | "denied" | "prompt";

interface MediaPermission {
  camera: PermissionStatus;
  microphone: PermissionStatus;
}

interface PermissionCheckProps {
  onPermissionsGranted: () => void;
  onCancel: () => void;
}

export function PermissionCheck({
  onPermissionsGranted,
  onCancel
}: PermissionCheckProps) {
  const [permissions, setPermissions] = useState<MediaPermission>({
    camera: "checking",
    microphone: "checking"
  });

  const [errorMessage, setErrorMessage] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    checkPermissions();
  }, []);

  // === PERMISSION CHECKER ===
  const checkPermissions = async () => {
    try {
      if (navigator.permissions) {
        const cameraPerm = await navigator.permissions.query({
          name: "camera" as PermissionName
        });
        const micPerm = await navigator.permissions.query({
          name: "microphone" as PermissionName
        });

        setPermissions({
          camera: cameraPerm.state as PermissionStatus,
          microphone: micPerm.state as PermissionStatus
        });

        cameraPerm.addEventListener("change", () =>
          setPermissions((prev) => ({
            ...prev,
            camera: cameraPerm.state as PermissionStatus
          }))
        );

        micPerm.addEventListener("change", () =>
          setPermissions((prev) => ({
            ...prev,
            microphone: micPerm.state as PermissionStatus
          }))
        );

        if (cameraPerm.state === "granted" && micPerm.state === "granted") {
          setTimeout(onPermissionsGranted, 300);
        }
      } else {
        setPermissions({ camera: "prompt", microphone: "prompt" });
      }
    } catch (err) {
      setPermissions({ camera: "prompt", microphone: "prompt" });
    }
  };

  // === REQUEST PERMISSIONS ===
  const requestPermissions = async () => {
    setIsRequesting(true);
    setErrorMessage("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Ваш браузер не поддерживает доступ к камере и микрофону."
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    width: { ideal: 1980 },
    height: { ideal: 1080 },
    aspectRatio: { ideal: 16 / 9 },
    facingMode: "user"
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
});


      stream.getTracks().forEach((t) => t.stop());

      setPermissions({ camera: "granted", microphone: "granted" });

      setTimeout(onPermissionsGranted, 300);
    } catch (error: any) {
      let err = "Не удалось получить доступ к камере/микрофону. ";

      switch (error.name) {
        case "NotAllowedError":
        case "PermissionDeniedError":
          err +=
            "Разрешение отклонено. Пожалуйста, включите камеру и микрофон в настройках браузера.";
          setPermissions({ camera: "denied", microphone: "denied" });
          break;
        case "NotFoundError":
          err += "Камера или микрофон не найдены.";
          break;
        case "NotReadableError":
          err +=
            "Ваши устройства заняты другой программой. Закройте другие приложения.";
          break;
        case "OverconstrainedError":
          err += "Выбранная камера не поддерживает требуемые параметры.";
          break;
        default:
          err += error.message || "Неизвестная ошибка.";
      }

      setErrorMessage(err);
    } finally {
      setIsRequesting(false);
    }
  };

  const getIcon = (status: PermissionStatus) => {
    switch (status) {
      case "granted":
        return <CheckCircle className="w-6 h-6 text-green-400" />;
      case "denied":
        return <XCircle className="w-6 h-6 text-red-500" />;
      case "checking":
        return (
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        );
      default:
        return <AlertCircle className="w-6 h-6 text-yellow-500" />;
    }
  };

  const bothGranted =
    permissions.camera === "granted" &&
    permissions.microphone === "granted";

  const anyDenied =
    permissions.camera === "denied" ||
    permissions.microphone === "denied";

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-pink-800 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl p-8 max-w-md w-full border border-gray-800">

        <h2 className="text-2xl font-bold text-white mb-2">
          Проверка разрешений
        </h2>
        <p className="text-gray-400 mb-6">
          Разрешите доступ к камере и микрофону, чтобы начать видеочат
        </p>

        {/* CAMERA */}
        <div className="space-y-4 mb-6">
          <div className="flex items-center justify-between p-4 bg-gray-800 rounded-xl">
            <div className="flex items-center gap-3">
              <Camera className="w-6 h-6 text-purple-400" />
              <div>
                <div className="text-white font-semibold">Камера</div>
                <div className="text-sm text-gray-400">
                  {permissions.camera === "granted"
                    ? "Разрешено"
                    : permissions.camera === "denied"
                    ? "Отклонено"
                    : permissions.camera === "checking"
                    ? "Проверка..."
                    : "Требуется разрешение"}
                </div>
              </div>
            </div>
            {getIcon(permissions.camera)}
          </div>

          {/* MICROPHONE */}
          <div className="flex items-center justify-between p-4 bg-gray-800 rounded-xl">
            <div className="flex items-center gap-3">
              <Mic className="w-6 h-6 text-purple-400" />
              <div>
                <div className="text-white font-semibold">Микрофон</div>
                <div className="text-sm text-gray-400">
                  {permissions.microphone === "granted"
                    ? "Разрешено"
                    : permissions.microphone === "denied"
                    ? "Отклонено"
                    : permissions.microphone === "checking"
                    ? "Проверка..."
                    : "Требуется разрешение"}
                </div>
              </div>
            </div>
            {getIcon(permissions.microphone)}
          </div>
        </div>

        {/* ERROR */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300">
            <div className="flex gap-2">
              <AlertCircle className="w-5 h-5 text-red-400" />
              {errorMessage}
            </div>
          </div>
        )}

        {/* DENIED help hint */}
        {anyDenied && (
          <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg text-xs text-yellow-300 leading-relaxed">
            <b>Как разрешить доступ:</b>
            <ul className="list-disc pl-4 mt-2 space-y-1">
              <li>Нажмите на значок замка в адресной строке</li>
              <li>Откройте настройки сайта</li>
              <li>Разрешите «Камеру» и «Микрофон»</li>
              <li>Обновите страницу</li>
            </ul>
          </div>
        )}

        {/* BUTTONS */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-xl transition font-semibold"
          >
            Отмена
          </button>

          <button
            onClick={requestPermissions}
            disabled={isRequesting || bothGranted}
            className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl transition font-semibold"
          >
            {isRequesting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Проверка...
              </div>
            ) : bothGranted ? (
              "Разрешено"
            ) : (
              "Разрешить доступ"
            )}
          </button>
        </div>

        <p className="text-center text-xs text-gray-500 mt-4">
          Мы не записываем и не храним ваше видео или аудио
        </p>
      </div>
    </div>
  );
}
