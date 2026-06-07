<?php
/**
 * GoldDesk Databox PHP bridge.
 * Reads JSON from STDIN and writes JSON to STDOUT.
 * Uses dfridrich/czech-data-box for ISDS communication.
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Defr\CzechDataBox\DataBox;

function out(array $payload, int $code = 0): never
{
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
    exit($code);
}

function input(): array
{
    $raw = stream_get_contents(STDIN);
    $data = json_decode($raw ?: '{}', true);
    if (!is_array($data)) {
        out(['ok' => false, 'error' => 'Invalid JSON input.'], 2);
    }
    return $data;
}

function dateToIso($value): ?string
{
    if ($value instanceof DateTimeInterface) {
        return $value->format(DateTimeInterface::ATOM);
    }
    if (is_string($value) && trim($value) !== '') {
        $ts = strtotime($value);
        return $ts ? date(DateTimeInterface::ATOM, $ts) : $value;
    }
    return null;
}

function callGetter(object $object, array $names)
{
    foreach ($names as $name) {
        if (method_exists($object, $name)) {
            try {
                $ref = new ReflectionMethod($object, $name);
                if ($ref->getNumberOfRequiredParameters() === 0) {
                    return $object->{$name}();
                }
            } catch (Throwable $e) {
                // continue
            }
        }
    }
    return null;
}

function scalarize($value)
{
    if ($value instanceof DateTimeInterface) {
        return $value->format(DateTimeInterface::ATOM);
    }
    if (is_scalar($value) || $value === null) {
        return $value;
    }
    if (is_array($value)) {
        return array_map('scalarize', $value);
    }
    if (is_object($value)) {
        return gettersToArray($value);
    }
    return (string)$value;
}

function gettersToArray(object $object): array
{
    $result = ['__class' => get_class($object)];
    foreach (get_class_methods($object) as $method) {
        if (!str_starts_with($method, 'get')) {
            continue;
        }
        try {
            $ref = new ReflectionMethod($object, $method);
            if ($ref->getNumberOfRequiredParameters() > 0) {
                continue;
            }
            $key = lcfirst(substr($method, 3));
            $result[$key] = scalarize($object->{$method}());
        } catch (Throwable $e) {
            // Some generated SOAP getters can throw if unset. Ignore safely.
        }
    }
    return $result;
}

function normalizeEnvelope(object $message): array
{
    $raw = gettersToArray($message);
    $dmId = callGetter($message, ['getDmID', 'getDmId', 'getId']);
    $subject = callGetter($message, ['getDmAnnotation', 'getAnnotation', 'getDmSubject', 'getSubject']);
    $senderName = callGetter($message, ['getDmSender', 'getSender', 'getDmSenderIdent']);
    $senderId = callGetter($message, ['getDbIDSender', 'getDbIdSender', 'getSenderID', 'getSenderId']);
    $senderIco = callGetter($message, ['getDmSenderIco', 'getSenderIco', 'getDmSenderOrgUnitNum']);
    $recipientName = callGetter($message, ['getDmRecipient', 'getRecipient', 'getDmRecipientIdent']);
    $recipientId = callGetter($message, ['getDbIDRecipient', 'getDbIdRecipient', 'getRecipientID', 'getRecipientId']);
    $deliveredAt = callGetter($message, ['getDmDeliveryTime', 'getDeliveryTime', 'getDeliveredAt']);
    $acceptedAt = callGetter($message, ['getDmAcceptanceTime', 'getAcceptanceTime', 'getAcceptedAt']);

    return [
        'dm_id' => $dmId !== null ? (string)$dmId : null,
        'subject' => $subject !== null ? (string)$subject : null,
        'sender_name' => $senderName !== null ? (string)$senderName : null,
        'sender_id_ds' => $senderId !== null ? (string)$senderId : null,
        'sender_ico' => $senderIco !== null ? (string)$senderIco : null,
        'recipient_name' => $recipientName !== null ? (string)$recipientName : null,
        'recipient_id_ds' => $recipientId !== null ? (string)$recipientId : null,
        'delivered_at' => dateToIso($deliveredAt),
        'accepted_at' => dateToIso($acceptedAt),
        'raw' => $raw,
    ];
}

function filePayload($file): ?array
{
    if (!$file || !is_object($file) || !method_exists($file, 'get')) {
        return null;
    }
    $content = $file->get();
    if ($content === false || $content === null || $content === '') {
        return null;
    }
    $filename = method_exists($file, 'getFilename') ? $file->getFilename() : 'message.zfo';
    return [
        'filename' => (string)$filename,
        'mime_type' => 'application/octet-stream',
        'content_base64' => base64_encode($content),
        'size_bytes' => strlen($content),
    ];
}

function buildDataBox(array $data): array
{
    $username = (string)($data['username'] ?? '');
    $password = (string)($data['password'] ?? '');
    $isTest = (bool)($data['is_test'] ?? false);
    if ($username === '' || $password === '') {
        out(['ok' => false, 'error' => 'Chybí login nebo heslo k datové schránce.'], 2);
    }

    $cacheDir = (string)($data['cache_dir'] ?? getenv('ISDS_CACHE_DIR') ?: sys_get_temp_dir() . '/GoldDeskDataBox');
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0770, true);
    }

    $dataBox = new DataBox($cacheDir);
    $dataBox->loginWithUsernameAndPassword($username, $password, !$isTest);
    return [$dataBox, $dataBox->getSimpleApi()];
}

try {
    $data = input();
    $command = (string)($data['command'] ?? 'test');
    [$dataBox, $simpleApi] = buildDataBox($data);

    if ($command === 'test') {
        $owner = $simpleApi->getDataBoxInfo();
        $user = $simpleApi->getUserInfo();
        $expires = $simpleApi->getPasswordExpires();
        out([
            'ok' => true,
            'owner' => is_object($owner) ? gettersToArray($owner) : scalarize($owner),
            'user' => is_object($user) ? gettersToArray($user) : scalarize($user),
            'password_expires_at' => dateToIso($expires),
        ]);
    }

    if ($command === 'received' || $command === 'sent') {
        $days = max(1, min(365, (int)($data['days'] ?? 90)));
        $limit = max(1, min(1000, (int)($data['limit'] ?? 100)));
        $download = (bool)($data['download'] ?? true);

        $list = $command === 'sent'
            ? $simpleApi->getListOfSentMessages($days, $limit)
            : $simpleApi->getListOfReceivedMessages($days, $limit);

        $items = [];
        foreach (($list ?: []) as $message) {
            if (!is_object($message)) {
                continue;
            }
            $row = normalizeEnvelope($message);
            $dmId = $row['dm_id'];
            if ($download && $dmId) {
                $signed = $command === 'sent'
                    ? $simpleApi->downloadSignedSentMessage($dmId)
                    : $simpleApi->downloadSignedReceivedMessage($dmId);
                $row['signed_message'] = filePayload($signed);
                try {
                    $row['delivery_info'] = filePayload($simpleApi->downloadDeliveryInfo($dmId));
                } catch (Throwable $e) {
                    $row['delivery_info_error'] = $e->getMessage();
                }

                $attachments = [];
                if ($command === 'received') {
                    try {
                        foreach (($simpleApi->getReceivedDataMessageAttachments($dmId) ?: []) as $att) {
                            $payload = filePayload($att);
                            if ($payload) {
                                $payload['mime_type'] = function_exists('mime_content_type') && method_exists($att, 'getLocation')
                                    ? (@mime_content_type($att->getLocation()) ?: 'application/octet-stream')
                                    : 'application/octet-stream';
                                $attachments[] = $payload;
                            }
                        }
                    } catch (Throwable $e) {
                        $row['attachments_error'] = $e->getMessage();
                    }
                }
                $row['attachments'] = $attachments;
            }
            $items[] = $row;
        }
        out(['ok' => true, 'direction' => $command, 'count' => count($items), 'messages' => $items]);
    }

    if ($command === 'find') {
        $id = (string)($data['id_ds'] ?? '');
        if ($id === '') {
            out(['ok' => false, 'error' => 'Chybí id_ds.'], 2);
        }
        $result = $simpleApi->findDataBoxById($id);
        out(['ok' => true, 'result' => scalarize($result)]);
    }

    out(['ok' => false, 'error' => 'Unknown command: ' . $command], 2);
} catch (Throwable $e) {
    out([
        'ok' => false,
        'error' => $e->getMessage(),
        'type' => get_class($e),
    ], 1);
}
