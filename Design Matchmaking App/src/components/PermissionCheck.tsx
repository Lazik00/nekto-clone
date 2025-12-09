import { useState, useEffect } from 'react';
import { Camera, Mic, AlertCircle, CheckCircle, XCircle } from 'lucide-react';

type PermissionStatus = 'checking' | 'granted' | 'denied' | 'prompt';

interface MediaPermission {
  camera: PermissionStatus;
  microphone: PermissionStatus;
}

interface PermissionCheckProps {
  onPermissionsGranted: () => void;
  onCancel: () => void;
}

export function PermissionCheck({ onPermissionsGranted, onCancel }: PermissionCheckProps) {
  const [permissions, setPermissions] = useState<MediaPermission>({
    camera: 'checking',
    microphone: 'checking'
  });
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    try {
      // Check if browser supports permissions API
      if (navigator.permissions) {
        const cameraPermission = await navigator.permissions.query({ name: 'camera' as PermissionName });
        const microphonePermission = await navigator.permissions.query({ name: 'microphone' as PermissionName });

        setPermissions({
          camera: cameraPermission.state as PermissionStatus,
          microphone: microphonePermission.state as PermissionStatus
        });

        // Listen for permission changes
        cameraPermission.addEventListener('change', () => {
          setPermissions(prev => ({ ...prev, camera: cameraPermission.state as PermissionStatus }));
        });

        microphonePermission.addEventListener('change', () => {
          setPermissions(prev => ({ ...prev, microphone: microphonePermission.state as PermissionStatus }));
        });

        // If both permissions are granted, proceed automatically
        if (cameraPermission.state === 'granted' && microphonePermission.state === 'granted') {
          onPermissionsGranted();
        }
      } else {
        // Fallback: try to request permissions directly
        setPermissions({ camera: 'prompt', microphone: 'prompt' });
      }
    } catch (error) {
      console.error('Permission check error:', error);
      setPermissions({ camera: 'prompt', microphone: 'prompt' });
    }
  };

  const requestPermissions = async () => {
    setIsRequesting(true);
    setErrorMessage('');

    try {
      // Check if mediaDevices is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Ваш браузер не поддерживает доступ к камере/микрофону. Пожалуйста, используйте современный браузер, такой как Chrome, Firefox или Edge.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Stop the stream immediately - we just needed to check permissions
      stream.getTracks().forEach(track => track.stop());

      setPermissions({ camera: 'granted', microphone: 'granted' });

      // Proceed to chat
      setTimeout(() => {
        onPermissionsGranted();
      }, 500);

    } catch (error: any) {
      console.error('Permission request error:', error);

      let errorMsg = 'Не удалось получить доступ к камере/микрофону. ';

      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMsg += 'Разрешение отклонено. Пожалуйста, разрешите доступ к камере и микрофону в настройках браузера.';
        setPermissions({ camera: 'denied', microphone: 'denied' });
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMsg += 'Камера или микрофон не найдены. Пожалуйста, подключите устройства и попробуйте снова.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMsg += 'Камера или микрофон уже используются другим приложением. Закройте другие приложения и попробуйте снова.';
      } else if (error.name === 'OverconstrainedError') {
        errorMsg += 'Камера/микрофон не соответствуют требуемым характеристикам. Попробуйте другие устройства.';
      } else if (error.name === 'SecurityError') {
        errorMsg += 'Доступ заблокирован из-за ограничений безопасности. Убедитесь, что используете HTTPS или localhost.';
      } else if (error.message) {
        errorMsg += error.message;
      }

      setErrorMessage(errorMsg);
    } finally {
      setIsRequesting(false);
    }
  };

  const getStatusIcon = (status: PermissionStatus) => {
    switch (status) {
      case 'granted':
        return <CheckCircle className="w-6 h-6 text-green-500" />;
      case 'denied':
        return <XCircle className="w-6 h-6 text-red-500" />;
      case 'checking':
        return <div className="w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />;
      default:
        return <AlertCircle className="w-6 h-6 text-yellow-500" />;
    }
  };

  const getStatusText = (status: PermissionStatus) => {
    switch (status) {
      case 'granted':
        return 'Разрешено';
      case 'denied':
        return 'Отклонено';
      case 'checking':
        return 'Проверка...';
      default:
        return 'Требуется разрешение';
    }
  };

  const bothGranted = permissions.camera === 'granted' && permissions.microphone === 'granted';
  const anyDenied = permissions.camera === 'denied' || permissions.microphone === 'denied';

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-pink-800 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl p-8 max-w-md w-full border border-gray-800">
        <h2 className="text-2xl font-bold text-white mb-2">Проверка разрешений</h2>
        <p className="text-gray-400 mb-6">
          Для видеочата требуется доступ к вашей камере и микрофону
        </p>

        <div className="space-y-4 mb-6">
          {/* Camera Permission */}
          <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
            <div className="flex items-center gap-3">
              <Camera className="w-6 h-6 text-purple-400" />
              <div>
                <div className="text-white font-medium">Камера</div>
                <div className="text-sm text-gray-400">{getStatusText(permissions.camera)}</div>
              </div>
            </div>
            {getStatusIcon(permissions.camera)}
          </div>

          {/* Microphone Permission */}
          <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
            <div className="flex items-center gap-3">
              <Mic className="w-6 h-6 text-purple-400" />
              <div>
                <div className="text-white font-medium">Микрофон</div>
                <div className="text-sm text-gray-400">{getStatusText(permissions.microphone)}</div>
              </div>
            </div>
            {getStatusIcon(permissions.microphone)}
          </div>
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-lg">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-red-400 text-sm font-medium mb-1">Ошибка доступа</div>
                <div className="text-red-300 text-sm">{errorMessage}</div>
              </div>
            </div>
          </div>
        )}

        {anyDenied && (
          <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-800 rounded-lg">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="text-yellow-300 text-sm">
                <p className="font-medium mb-2">Как разрешить доступ:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Нажмите на значок замка в адресной строке браузера</li>
                  <li>Найдите настройки камеры и микрофона</li>
                  <li>Установите "Разрешить" для обоих устройств</li>
                  <li>Обновите страницу</li>
                </ol>
                <p className="mt-2">
                  <a
                    href="/CAMERA_PERMISSIONS_GUIDE.md"
                    target="_blank"
                    className="text-yellow-400 hover:text-yellow-300 underline"
                  >
                    Подробное руководство →
                  </a>
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition font-medium"
          >
            Отмена
          </button>
          <button
            onClick={requestPermissions}
            disabled={isRequesting || bothGranted}
            className="flex-1 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRequesting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Проверка...
              </div>
            ) : bothGranted ? (
              'Разрешено'
            ) : (
              'Запросить доступ'
            )}
          </button>
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">
            Мы не сохраняем и не записываем ваши видео или аудио
          </p>
        </div>
      </div>
    </div>
  );
}

