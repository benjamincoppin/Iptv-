<?php
header('X-Robots-Tag: noindex, nofollow, noarchive, nosnippet', true);
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

$key = isset($_GET['key']) ? $_GET['key'] : '';
if (!preg_match('/^[a-f0-9]{64}$/', $key)) {
    http_response_code(404);
    exit;
}

$dir = __DIR__ . '/.data';
if (!is_dir($dir)) {
    mkdir($dir, 0700, true);
    file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    file_put_contents($dir . '/index.html', '');
}

$fp = fopen($dir . '/' . $key . '.json', 'c+');
if (!$fp) { http_response_code(500); exit; }
flock($fp, LOCK_EX);
$current = json_decode(stream_get_contents($fp) ?: '{}', true);
$items = (is_array($current) && isset($current['items']) && is_array($current['items'])) ? $current['items'] : array();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input', false, null, 0, 1048576);
    $in = json_decode($raw, true);
    if (is_array($in) && isset($in['items']) && is_array($in['items'])) {
        foreach ($in['items'] as $k => $v) {
            if (!is_string($k) || strlen($k) > 80 || !is_array($v) || strlen(json_encode($v)) > 4000) continue;
            $ts = isset($v['ts']) ? (float)$v['ts'] : 0;
            if (!isset($items[$k]) || (isset($items[$k]['ts']) ? (float)$items[$k]['ts'] : 0) < $ts) {
                $items[$k] = $v;
            }
        }
        uasort($items, function ($a, $b) {
            $ta = isset($a['ts']) ? (float)$a['ts'] : 0;
            $tb = isset($b['ts']) ? (float)$b['ts'] : 0;
            return $tb <=> $ta;
        });
        $items = array_slice($items, 0, 400, true);
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode(array('items' => $items), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        fflush($fp);
    }
}
flock($fp, LOCK_UN);
fclose($fp);

echo json_encode(array('items' => (object)$items, 'time' => round(microtime(true) * 1000)), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
